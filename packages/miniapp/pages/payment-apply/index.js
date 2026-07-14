const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const {
  wxChooseMediaImage,
  wxChooseLocalFile,
  wxChooseMessageFile,
  isMessageFilePickerSupported
} = require("../../utils/wx");
const { firstError, required, positiveNumber } = require("../../utils/validation");
const { getUserProfile } = require("../../utils/auth");

const today = () => new Date().toISOString().slice(0, 10);

const extractErrorMessage = (error, fallback = "上传失败") => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const errMsg = error.errMsg || error.message;
    if (typeof errMsg === "string" && errMsg.trim()) return errMsg.trim();
  }
  return fallback;
};

const isLocalFilePickerUnsupportedError = (error) => {
  const message = extractErrorMessage(error, "").toLowerCase();
  return message.includes("不支持本地文件选择") || message.includes("local file") || message.includes("choosefile");
};

const confirmMessageFileFallback = () =>
  new Promise((resolve) => {
    wx.showModal({
      title: "本地文件不可用",
      content: "当前客户端不支持本地文件选择，是否改为“从会话文件选择”继续上传？",
      confirmText: "继续选择",
      cancelText: "取消",
      success: (res) => resolve(Boolean(res && res.confirm)),
      fail: () => resolve(false)
    });
  });

const canLaunchPayment = (roles) => {
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager") ||
    roles.includes("operator") ||
    roles.includes("finance")
  );
};

const toChineseAmount = (amount) => {
  const value = Number(amount || 0);
  if (!Number.isFinite(value) || value < 0) return "金额格式错误";
  if (value === 0) return "零元整";

  const fractionUnits = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const intUnits = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];

  let scaled = Math.round(value * 100);
  const fraction = scaled % 100;
  let result = "";

  if (fraction === 0) {
    result = "整";
  } else {
    const jiao = Math.floor(fraction / 10);
    const fen = fraction % 10;
    if (jiao > 0) result += `${digit[jiao]}${fractionUnits[0]}`;
    if (fen > 0) result += `${digit[fen]}${fractionUnits[1]}`;
  }

  scaled = Math.floor(scaled / 100);
  let sectionIndex = 0;
  let intResult = "";

  while (scaled > 0 && sectionIndex < sectionUnits.length) {
    const sectionValue = scaled % 10000;
    if (sectionValue !== 0) {
      let sectionText = "";
      let unitIndex = 0;
      let section = sectionValue;
      let zeroPending = false;

      while (section > 0) {
        const num = section % 10;
        if (num === 0) {
          if (!zeroPending && sectionText) {
            zeroPending = true;
            sectionText = `零${sectionText}`;
          }
        } else {
          zeroPending = false;
          sectionText = `${digit[num]}${intUnits[unitIndex]}${sectionText}`;
        }
        unitIndex += 1;
        section = Math.floor(section / 10);
      }

      sectionText = sectionText.replace(/零+/g, "零").replace(/零$/g, "");
      intResult = `${sectionText}${sectionUnits[sectionIndex]}${intResult}`;
    } else if (intResult && !intResult.startsWith("零")) {
      intResult = `零${intResult}`;
    }
    sectionIndex += 1;
    scaled = Math.floor(scaled / 10000);
  }

  intResult = intResult.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
  intResult = intResult.replace(/亿万/g, "亿").replace(/零$/g, "");

  return `${intResult || "零"}元${result}`;
};

const formatAmountDisplay = (amount) => {
  const value = Number(amount || 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${toChineseAmount(value)}）`;
};

const formatAmountNumber = (amount) => {
  const value = Number(amount || 0);
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const normalizeAttachment = (item) => {
  return {
    file_key: item.file_key,
    file_name: item.file_name || item.file_key,
    file_size: item.file_size || undefined
  };
};

const serializeAttachments = (list) => {
  return JSON.stringify((Array.isArray(list) ? list : []).map(normalizeAttachment));
};

const sortContractsNewestFirst = (list) => {
  return (Array.isArray(list) ? list.slice() : []).sort((a, b) => {
    const timeA = new Date(a && (a.created_at || a.contract_date || "")).getTime();
    const timeB = new Date(b && (b.created_at || b.contract_date || "")).getTime();
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return Number((b && b.id) || 0) - Number((a && a.id) || 0);
  });
};

const resolveContractRemaining = (contract) => {
  const total = Number((contract && contract.total_amount) || 0);
  const paid = Number((contract && contract.paid_amount) || 0);
  if (!Number.isFinite(total) || !Number.isFinite(paid)) return 0;
  return Number((total - paid).toFixed(2));
};

const buildHandlerNameMap = (wecomUsers) => {
  const map = {};
  (Array.isArray(wecomUsers) ? wecomUsers : []).forEach((item) => {
    if (item && item.userid) {
      map[item.userid] = item.name || item.userid;
    }
  });
  return map;
};

const resolveHandlerName = (contract, handlerNameMap) => {
  const userid = String((contract && contract.handler_userid) || "").trim();
  if (!userid) return "未知提交人";
  return (handlerNameMap && handlerNameMap[userid]) || userid;
};

// 合同摘要：对方单位｜合同类型｜剩余额度｜提交人（经办人近似）
const buildContractSummary = (contract, handlerNameMap) => {
  const counterparty = String((contract && contract.counterparty) || "").trim() || "未填对方单位";
  const contractType = String((contract && contract.contract_type) || "").trim() || "其他";
  const remainingText = formatAmountNumber(resolveContractRemaining(contract));
  const handlerName = resolveHandlerName(contract, handlerNameMap);
  return `${counterparty}｜${contractType}｜剩余 ${remainingText}｜${handlerName}`;
};

// 默认仅显示"自己经办 + 剩余额度>0"的合同；showAll 时显示所有剩余>0 的合同
const filterVisibleContracts = (contracts, { myUserid, showAll }) => {
  const list = Array.isArray(contracts) ? contracts : [];
  const mine = String(myUserid || "").trim();
  return sortContractsNewestFirst(
    list.filter((item) => {
      if (resolveContractRemaining(item) <= 0) return false;
      if (showAll) return true;
      return String((item && item.handler_userid) || "").trim() === mine;
    })
  );
};

const buildContractLabels = (visibleContracts, handlerNameMap, { withNoneOption }) => {
  const summaries = (Array.isArray(visibleContracts) ? visibleContracts : []).map((item) =>
    buildContractSummary(item, handlerNameMap)
  );
  return withNoneOption ? ["无合同 / 无需合同"].concat(summaries) : summaries;
};

const buildPayeeLabels = (payees) => {
  return ["请选择外部收款方"].concat(
    (Array.isArray(payees) ? payees : []).map((item) => `${item.name} (${item.bank_name || "-"})`)
  );
};

const buildDirectPaymentSummary = ({ form, amount, payee, contract }) => {
  const content = String((form && form.content) || "").trim() || "未填写付款事由";
  const payeeName = payee && payee.name ? payee.name : "未选择收款方";
  const amountText = formatAmountNumber(amount);
  if (contract) {
    const contractText = contract.contract_no || contract.counterparty || "已关联合同";
    return `智能发单台-合同直付｜${content}｜${contractText}｜${amountText}元`;
  }
  return `智能发单台-直接付款｜${content}｜${payeeName}｜${amountText}元`;
};

Page({
  data: {
    loadingMeta: false,
    currentStep: 0,
    busy: false,
    checking: false,
    submitting: false,
    thresholdLimit: 10000,
    exceedsThreshold: false,
    shouldUseContractFlow: false,
    amountInput: "",
    amountDisplay: formatAmountDisplay(0),

    payees: [],
    payeeLabels: ["请选择外部收款方"],
    entities: [],
    entityLabels: ["请选择我方主体"],
    contracts: [],
    visibleContracts: [],
    contractLabels: ["无合同 / 无需合同"],
    handlerNameMap: {},
    myUserid: "",
    showAllContracts: false,
    contractEntryOpen: false,
    wecomUsers: [],
    wecomUserLabels: ["请选择经办人"],

    directForm: {
      contract_id: null,
      project_id: "",
      payee_id: "",
      category: "其他费用",
      content: "",
      payment_method: "对公转账",
      expected_payment_date: today(),
      remark: ""
    },
    directProjectValue: 0,
    directProjectName: "",
    contractForm: {
      project_id: "",
      entity_id: "",
      payee_id: "",
      contract_type: "其他",
      handler_userid: "",
      contract_date: today(),
      remark: ""
    },
    contractProjectValue: 0,
    contractProjectName: "",
    withFirstPayment: false,
    firstPaymentForm: {
      amount: "",
      category: "prepayment",
      content: "首笔预付款",
      payment_method: "对公转账",
      expected_payment_date: today(),
      remark: ""
    },
    firstPaymentAmountText: "",

    directContractIndex: 0,
    directContractRemaining: null,
    directContractRemainingText: "",
    directPayeeIndex: 0,
    contractEntityIndex: 0,
    contractPayeeIndex: 0,
    contractHandlerIndex: 0,

    directCategoryOptions: ["特殊审批", "行政费", "劳务费", "机械费", "材料费", "其他费用"],
    directCategoryIndex: 5,
    paymentMethodOptions: ["对公转账", "现金", "票据", "其他"],
    directPaymentMethodIndex: 0,

    contractTypeOptions: ["人工", "机械", "总包", "材料", "其他"],
    contractTypeIndex: 4,

    firstPaymentCategoryValues: ["prepayment", "progress", "settlement", "其他费用"],
    firstPaymentCategoryOptions: ["预付款", "进度款", "结算款", "其他费用"],
    firstPaymentCategoryIndex: 0,
    firstPaymentMethodIndex: 0,

    quickPayeeVisible: false,
    quickPayeeSubmitting: false,
    quickPayeeTarget: "direct",
    quickPayeeForm: {
      name: "",
      bank_name: "",
      bank_account: "",
      phone: ""
    },

    directPaymentAttachments: [],
    contractAttachments: [],
    firstPaymentAttachments: [],
    selectedDirectPayee: null,
    selectedContractPayee: null
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canLaunchPayment(roles)) {
      wx.showToast({ title: "当前角色无对外付款权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 400);
      return;
    }
    this.loadMeta();
  },

  async loadMeta() {
    if (this.data.loadingMeta) return;
    this.setData({ loadingMeta: true });
    try {
      const [thresholdRes, payeeRes, contractRes, entityRes, wecomRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/admin/thresholds?biz_type=payment_request" }).catch((error) => ({ _error: error })),
        request({ method: "GET", path: "/api/v1/payment/payee/list?type=external" }).catch((error) => ({ _error: error })),
        request({ method: "GET", path: "/api/v1/contract?direction=outbound&page=1&pageSize=200" }).catch((error) => ({ _error: error })),
        request({ method: "GET", path: "/api/v1/entity?page=1&pageSize=200" }).catch((error) => ({ _error: error })),
        request({ method: "GET", path: "/api/v1/auth/wecom/contacts" }).catch((error) => ({ _error: error }))
      ]);

      const hasPartialError = [thresholdRes, payeeRes, contractRes, entityRes, wecomRes].some(
        (item) => item && item._error
      );
      if (hasPartialError) {
        wx.showToast({ title: "部分基础数据加载失败，已使用可用数据继续", icon: "none" });
      }

      const thresholds = thresholdRes && Array.isArray(thresholdRes.data) ? thresholdRes.data : [];
      const thresholdLimit = thresholds.length
        ? thresholds.reduce((min, item) => {
            const value = Number(item.threshold_value || 0);
            if (!Number.isFinite(value) || value <= 0) return min;
            if (!min) return value;
            return value < min ? value : min;
          }, 0) || 10000
        : 10000;

      const payees = payeeRes && Array.isArray(payeeRes.data) ? payeeRes.data : [];
      const contracts = sortContractsNewestFirst(
        contractRes && Array.isArray(contractRes.data) ? contractRes.data : []
      );
      const entities = entityRes && Array.isArray(entityRes.data) ? entityRes.data : [];
      const wecomUsers =
        wecomRes && wecomRes.data && Array.isArray(wecomRes.data.users)
          ? wecomRes.data.users.filter((item) => item && item.userid)
          : [];

      const handlerNameMap = buildHandlerNameMap(wecomUsers);
      const myUserid = String((getUserProfile() || {}).username || "").trim();
      const visibleContracts = filterVisibleContracts(contracts, {
        myUserid,
        showAll: this.data.showAllContracts
      });

      this.setData({
        thresholdLimit,
        payees,
        payeeLabels: buildPayeeLabels(payees),
        contracts,
        handlerNameMap,
        myUserid,
        visibleContracts,
        contractLabels: buildContractLabels(visibleContracts, handlerNameMap, {
          withNoneOption: true
        }),
        entities,
        entityLabels: ["请选择我方主体"].concat(
          entities.map((item) => item.entity_name || item.entity_code || `主体${item.id}`)
        ),
        wecomUsers,
        wecomUserLabels: ["请选择经办人"].concat(
          wecomUsers.map((item) => `${item.name || item.userid} (${item.userid})`)
        )
      });
      this.checkAmount();
      this.syncSelectedPayeeInfo();
    } finally {
      this.setData({ loadingMeta: false });
    }
  },

  async reloadExternalPayees() {
    const payeeRes = await request({
      method: "GET",
      path: "/api/v1/payment/payee/list?type=external"
    });
    const payees = payeeRes && Array.isArray(payeeRes.data) ? payeeRes.data : [];
    this.setData({
      payees,
      payeeLabels: buildPayeeLabels(payees)
    });
    this.syncSelectedPayeeInfo();
    return payees;
  },

  syncSelectedPayeeInfo() {
    const payees = Array.isArray(this.data.payees) ? this.data.payees : [];
    const direct = payees.find((item) => Number(item.id) === Number(this.data.directForm.payee_id)) || null;
    const contract = payees.find((item) => Number(item.id) === Number(this.data.contractForm.payee_id)) || null;
    this.setData({
      selectedDirectPayee: direct,
      selectedContractPayee: contract
    });
  },

  openQuickPayee(e) {
    const target = (e.currentTarget.dataset.target || "direct") === "contract" ? "contract" : "direct";
    this.setData({
      quickPayeeVisible: true,
      quickPayeeTarget: target,
      quickPayeeForm: {
        name: "",
        bank_name: "",
        bank_account: "",
        phone: ""
      }
    });
  },

  closeQuickPayee() {
    this.setData({
      quickPayeeVisible: false,
      quickPayeeSubmitting: false,
      quickPayeeForm: {
        name: "",
        bank_name: "",
        bank_account: "",
        phone: ""
      }
    });
  },

  onQuickPayeeInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ [`quickPayeeForm.${key}`]: e.detail.value || "" });
  },

  async submitQuickPayee() {
    if (this.data.quickPayeeSubmitting) return;
    const form = this.data.quickPayeeForm || {};
    const payload = {
      name: String(form.name || "").trim(),
      bank_name: String(form.bank_name || "").trim(),
      bank_account: String(form.bank_account || "").trim(),
      phone: String(form.phone || "").trim()
    };
    const fieldError = firstError([
      required(payload.name, "收款人名称"),
      required(payload.bank_name, "开户行"),
      required(payload.bank_account, "银行账号")
    ]);
    if (fieldError) {
      wx.showToast({ title: fieldError, icon: "none" });
      return;
    }

    this.setData({ quickPayeeSubmitting: true });
    wx.showLoading({ title: "添加中...", mask: true });
    try {
      const created = await request({
        method: "POST",
        path: "/api/v1/payment/payee",
        data: {
          name: payload.name,
          bank_name: payload.bank_name,
          bank_account: payload.bank_account,
          phone: payload.phone || undefined,
          type: "external"
        }
      });
      const createdId = created && created.data ? Number(created.data.id || 0) : 0;
      if (!createdId) throw new Error("外部收款人创建失败");

      let payees = [];
      let refreshFailed = false;
      try {
        payees = await this.reloadExternalPayees();
      } catch {
        refreshFailed = true;
        payees = [
          {
            id: createdId,
            name: payload.name,
            bank_name: payload.bank_name,
            bank_account: payload.bank_account,
            phone: payload.phone || "",
            type: "external"
          }
        ].concat(this.data.payees || []);
        this.setData({
          payees,
          payeeLabels: buildPayeeLabels(payees)
        });
      }
      const nextIndex = payees.findIndex((item) => Number(item.id) === createdId) + 1;
      const pickerIndex = nextIndex > 0 ? nextIndex : 0;

      const selected = payees.find((item) => Number(item.id) === createdId) || {
        id: createdId,
        name: payload.name,
        bank_name: payload.bank_name,
        bank_account: payload.bank_account,
        phone: payload.phone || ""
      };

      if (this.data.quickPayeeTarget === "contract") {
        this.setData({
          contractPayeeIndex: pickerIndex,
          "contractForm.payee_id": String(createdId),
          selectedContractPayee: selected
        });
      } else {
        this.setData({
          directPayeeIndex: pickerIndex,
          "directForm.payee_id": String(createdId),
          selectedDirectPayee: selected
        });
      }

      this.closeQuickPayee();
      wx.hideLoading();
      wx.showToast({
        title: refreshFailed ? "已添加，列表已本地更新" : "外部收款人已添加",
        icon: "success"
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "添加失败", icon: "none" });
      this.setData({ quickPayeeSubmitting: false });
    }
  },

  onAmountInput(e) {
    const value = e.detail.value || "";
    this.setData({ amountInput: value }, () => this.checkAmount());
  },

  checkAmount() {
    this.setData({ checking: true });
    const amount = Number(this.data.amountInput || 0);
    const exceedsThreshold = amount > Number(this.data.thresholdLimit || 0);
    const contractId = this.data.directForm ? this.data.directForm.contract_id : null;
    this.setData({
      exceedsThreshold,
      shouldUseContractFlow: this.resolveShouldUseContractFlow(exceedsThreshold, contractId),
      directContractRemaining: this.resolveDirectContractRemaining(contractId),
      directContractRemainingText: this.resolveDirectContractRemainingText(contractId),
      amountDisplay: formatAmountDisplay(amount),
      checking: false
    });
  },

  resolveShouldUseContractFlow(exceedsThreshold, contractId) {
    return Boolean(exceedsThreshold && !(Number(contractId || 0) > 0));
  },

  resolveDirectContractRemaining(contractId) {
    const numericId = Number(contractId || 0);
    if (!(numericId > 0)) return null;
    const contract = (this.data.contracts || []).find((item) => Number(item.id) === numericId);
    if (!contract) return null;
    const total = Number(contract.total_amount || 0);
    const paid = Number(contract.paid_amount || 0);
    if (!Number.isFinite(total) || !Number.isFinite(paid)) return null;
    return Number((total - paid).toFixed(2));
  },

  resolveDirectContractRemainingText(contractId) {
    const remaining = this.resolveDirectContractRemaining(contractId);
    return remaining === null ? "" : formatAmountNumber(remaining);
  },

  onDirectProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    this.setData({
      directProjectValue: projectId,
      directProjectName: String(e.detail.projectName || ""),
      "directForm.project_id": String(projectId || "")
    });
  },

  onContractProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    this.setData({
      contractProjectValue: projectId,
      contractProjectName: String(e.detail.projectName || ""),
      "contractForm.project_id": String(projectId || "")
    });
  },

  onDirectContractChange(e) {
    const index = Number(e.detail.value || 0);
    const contract = index > 0 ? this.data.visibleContracts[index - 1] : null;
    const contractId = contract ? Number(contract.id) : null;
    const exceedsThreshold = Boolean(this.data.exceedsThreshold);
    this.setData({
      directContractIndex: index,
      "directForm.contract_id": contractId,
      shouldUseContractFlow: this.resolveShouldUseContractFlow(exceedsThreshold, contractId),
      directContractRemaining: this.resolveDirectContractRemaining(contractId),
      directContractRemainingText: this.resolveDirectContractRemainingText(contractId)
    });
  },

  // 切换"只看我的" / "加载全部合同"（纯前端过滤，不重新请求）
  toggleShowAllContracts() {
    const showAll = !this.data.showAllContracts;
    const visibleContracts = filterVisibleContracts(this.data.contracts, {
      myUserid: this.data.myUserid,
      showAll
    });
    const contractLabels = buildContractLabels(visibleContracts, this.data.handlerNameMap, {
      withNoneOption: true
    });
    const currentId = Number(this.data.directForm.contract_id || 0);
    const foundIndex =
      currentId > 0 ? visibleContracts.findIndex((item) => Number(item.id) === currentId) : -1;
    const stillVisible = foundIndex >= 0;
    const nextContractId = stillVisible ? currentId : null;
    const exceedsThreshold = Boolean(this.data.exceedsThreshold);
    this.setData({
      showAllContracts: showAll,
      visibleContracts,
      contractLabels,
      directContractIndex: stillVisible ? foundIndex + 1 : 0,
      "directForm.contract_id": nextContractId,
      shouldUseContractFlow: this.resolveShouldUseContractFlow(exceedsThreshold, nextContractId),
      directContractRemaining: this.resolveDirectContractRemaining(nextContractId),
      directContractRemainingText: this.resolveDirectContractRemainingText(nextContractId)
    });
  },

  // 第一步："通过已有合同发起付款"入口的展开/收起
  toggleContractEntry() {
    this.setData({ contractEntryOpen: !this.data.contractEntryOpen });
  },

  // 合同优先入口：选定合同后带入直付流程（合同/项目预填、尽量匹配收款方）
  onContractEntryPick(e) {
    const index = Number(e.detail.value || 0);
    const contract = index > 0 ? this.data.visibleContracts[index - 1] : null;
    const exceedsThreshold = Boolean(this.data.exceedsThreshold);
    if (!contract) {
      this.setData({
        directContractIndex: 0,
        "directForm.contract_id": null,
        shouldUseContractFlow: this.resolveShouldUseContractFlow(exceedsThreshold, null),
        directContractRemaining: null,
        directContractRemainingText: ""
      });
      return;
    }
    const contractId = Number(contract.id);
    const counterparty = String(contract.counterparty || "").trim();
    const payees = Array.isArray(this.data.payees) ? this.data.payees : [];
    const matchedPayee =
      counterparty !== ""
        ? payees.find((item) => String(item.name || "").trim() === counterparty) || null
        : null;
    const payeeIndex = matchedPayee
      ? payees.findIndex((item) => Number(item.id) === Number(matchedPayee.id)) + 1
      : this.data.directPayeeIndex;
    this.setData({
      directContractIndex: index,
      "directForm.contract_id": contractId,
      "directForm.project_id": String(contract.project_id || ""),
      directProjectValue: Number(contract.project_id || 0),
      directProjectName: "",
      directPayeeIndex: payeeIndex,
      "directForm.payee_id": matchedPayee ? String(matchedPayee.id) : this.data.directForm.payee_id,
      selectedDirectPayee: matchedPayee || this.data.selectedDirectPayee,
      shouldUseContractFlow: this.resolveShouldUseContractFlow(exceedsThreshold, contractId),
      directContractRemaining: this.resolveDirectContractRemaining(contractId),
      directContractRemainingText: this.resolveDirectContractRemainingText(contractId)
    });
  },

  onDirectPayeeChange(e) {
    const index = Number(e.detail.value || 0);
    const payee = index > 0 ? this.data.payees[index - 1] : null;
    this.setData({
      directPayeeIndex: index,
      "directForm.payee_id": payee ? String(payee.id) : "",
      selectedDirectPayee: payee || null
    });
  },

  onContractEntityChange(e) {
    const index = Number(e.detail.value || 0);
    const entity = index > 0 ? this.data.entities[index - 1] : null;
    this.setData({
      contractEntityIndex: index,
      "contractForm.entity_id": entity ? String(entity.id) : ""
    });
  },

  onContractPayeeChange(e) {
    const index = Number(e.detail.value || 0);
    const payee = index > 0 ? this.data.payees[index - 1] : null;
    this.setData({
      contractPayeeIndex: index,
      "contractForm.payee_id": payee ? String(payee.id) : "",
      selectedContractPayee: payee || null
    });
  },

  onContractHandlerChange(e) {
    const index = Number(e.detail.value || 0);
    const user = index > 0 ? this.data.wecomUsers[index - 1] : null;
    this.setData({
      contractHandlerIndex: index,
      "contractForm.handler_userid": user ? String(user.userid) : ""
    });
  },

  onDirectCategoryChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.directCategoryOptions[index] || "其他费用";
    this.setData({ directCategoryIndex: index, "directForm.category": selected });
  },

  onDirectPaymentMethodChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.paymentMethodOptions[index] || "对公转账";
    this.setData({ directPaymentMethodIndex: index, "directForm.payment_method": selected });
  },

  onContractTypeChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.contractTypeOptions[index] || "其他";
    this.setData({ contractTypeIndex: index, "contractForm.contract_type": selected });
  },

  onFirstPaymentCategoryChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.firstPaymentCategoryValues[index] || "prepayment";
    this.setData({ firstPaymentCategoryIndex: index, "firstPaymentForm.category": selected });
  },

  onFirstPaymentMethodChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = this.data.paymentMethodOptions[index] || "对公转账";
    this.setData({ firstPaymentMethodIndex: index, "firstPaymentForm.payment_method": selected });
  },

  onDirectDateChange(e) {
    this.setData({ "directForm.expected_payment_date": e.detail.value });
  },

  onContractDateChange(e) {
    this.setData({ "contractForm.contract_date": e.detail.value });
  },

  onFirstPaymentDateChange(e) {
    this.setData({ "firstPaymentForm.expected_payment_date": e.detail.value });
  },

  onDirectInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`directForm.${key}`]: e.detail.value || "" });
  },

  onContractInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`contractForm.${key}`]: e.detail.value || "" });
  },

  onFirstPaymentInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value || "";
    const patch = { [`firstPaymentForm.${key}`]: value };
    if (key === "amount") {
      const amount = Number(value || 0);
      patch.firstPaymentAmountText = amount > 0 ? formatAmountNumber(amount) : "";
    }
    this.setData(patch);
  },

  onFirstPaymentToggle(e) {
    this.setData({ withFirstPayment: Boolean(e.detail.value) });
  },

  removeAttachment(e) {
    const group = e.currentTarget.dataset.group;
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const groupMap = {
      direct: "directPaymentAttachments",
      contract: "contractAttachments",
      first: "firstPaymentAttachments"
    };
    const key = groupMap[group];
    if (!key) return;
    const list = (this.data[key] || []).slice();
    list.splice(index, 1);
    this.setData({ [key]: list });
  },

  async appendAttachment(group, item) {
    const groupMap = {
      direct: "directPaymentAttachments",
      contract: "contractAttachments",
      first: "firstPaymentAttachments"
    };
    const key = groupMap[group];
    if (!key) return;
    const list = [item].concat(this.data[key] || []);
    this.setData({ [key]: list });
  },

  async chooseImageAttachment(e) {
    const group = e.currentTarget.dataset.group;
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const choose = await wxChooseMediaImage();
      const file = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      if (!file || !file.tempFilePath) return;
      const uploaded = await uploadFileToR2(file.tempFilePath, {
        category: group === "contract" ? "contract" : "payment",
        fileName: file.name || `miniapp-${Date.now()}.jpg`
      });
      await this.appendAttachment(group, {
        file_key: uploaded.key,
        file_name: file.name || uploaded.key,
        file_size: file.size || undefined
      });
      wx.showToast({ title: "附件上传成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async chooseFileAttachment(e) {
    const group = e.currentTarget.dataset.group;
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const choose = await wxChooseLocalFile({
        count: 1,
        extension: [
          ".pdf",
          ".jpg",
          ".jpeg",
          ".png",
          ".webp",
          ".gif",
          ".bmp",
          ".tif",
          ".tiff",
          ".heic",
          ".heif",
          ".ofd",
          ".xml",
          ".txt",
          ".doc",
          ".docx",
          ".xls",
          ".xlsx"
        ]
      });
      const file = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      if (!file || !file.path) return;
      const uploaded = await uploadFileToR2(file.path, {
        category: group === "contract" ? "contract" : "payment",
        fileName: file.name || `miniapp-${Date.now()}.bin`
      });
      await this.appendAttachment(group, {
        file_key: uploaded.key,
        file_name: file.name || uploaded.key,
        file_size: file.size || undefined
      });
      wx.showToast({ title: "附件上传成功", icon: "success" });
    } catch (error) {
      if (isLocalFilePickerUnsupportedError(error) && isMessageFilePickerSupported()) {
        const confirmed = await confirmMessageFileFallback();
        if (!confirmed) {
          wx.showToast({ title: "已取消", icon: "none" });
          return;
        }
        await this.chooseMessageFileAttachment(group);
        return;
      }
      wx.showToast({ title: extractErrorMessage(error), icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async chooseMessageFileAttachment(group) {
    const choose = await wxChooseMessageFile({ count: 1, type: "file" });
    const file = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
    if (!file || !file.path) return;
    const uploaded = await uploadFileToR2(file.path, {
      category: group === "contract" ? "contract" : "payment",
      fileName: file.name || `miniapp-${Date.now()}.bin`
    });
    await this.appendAttachment(group, {
      file_key: uploaded.key,
      file_name: file.name || uploaded.key,
      file_size: file.size || undefined
    });
    wx.showToast({ title: "附件上传成功", icon: "success" });
  },

  goNextStep() {
    if (this.data.currentStep === 1 && this.data.quickPayeeVisible) {
      wx.showToast({ title: "请先完成或收起收款人添加", icon: "none" });
      return;
    }
    if (this.data.currentStep === 0) {
      const amount = Number(this.data.amountInput || 0);
      if (!(amount > 0)) {
        wx.showToast({ title: "请先填写预计付款总额", icon: "none" });
        return;
      }
    }
    if (this.data.currentStep === 1 && !this.validateFlowFields()) return;
    this.setData({ currentStep: Math.min(this.data.currentStep + 1, 2) });
  },

  goPrevStep() {
    this.setData({ currentStep: Math.max(this.data.currentStep - 1, 0) });
  },

  validateFlowFields() {
    const errorText = this.data.shouldUseContractFlow ? this.validateContractFlow() : this.validateDirect();
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return false;
    }
    return true;
  },

  validateDirect() {
    const form = this.data.directForm;
    const amount = Number(this.data.amountInput || 0);
    const threshold = Number(this.data.thresholdLimit || 0);
    const fieldError = firstError([
      positiveNumber(form.project_id, "所属项目"),
      positiveNumber(form.payee_id, "收款方"),
      positiveNumber(amount, "付款总额"),
      required(form.expected_payment_date, "付款日期"),
      required(form.category, "付款类别"),
      required(form.content, "付款事由"),
      required(form.payment_method, "付款方式")
    ]);
    if (fieldError) return fieldError;
    if (amount > threshold && !(Number(form.contract_id || 0) > 0)) {
      return `金额超过阈值 ${threshold.toLocaleString()}，请改走合同流程`;
    }
    const selectedContractRemaining = this.resolveDirectContractRemaining(form.contract_id);
    if (selectedContractRemaining !== null && amount > selectedContractRemaining) {
      return `当前合同可用额度为 ${formatAmountNumber(selectedContractRemaining)}，申请金额不能超过可用额度`;
    }
    if (!this.data.directPaymentAttachments.length) {
      return "请先上传付款附件";
    }
    return "";
  },

  validateContractFlow() {
    const amount = Number(this.data.amountInput || 0);
    const contract = this.data.contractForm;
    const first = this.data.firstPaymentForm;

    const baseError = firstError([
      positiveNumber(amount, "预计付款总额"),
      positiveNumber(contract.project_id, "所属项目"),
      positiveNumber(contract.entity_id, "我方主体"),
      positiveNumber(contract.payee_id, "对方单位"),
      required(contract.contract_type, "合同类型"),
      required(contract.contract_date, "合同日期"),
      required(contract.handler_userid, "经办人")
    ]);
    if (baseError) return baseError;
    if (!this.data.contractAttachments.length) {
      return "请先上传合同附件";
    }
    if (!this.data.withFirstPayment) return "";

    const firstErrorText = firstError([
      positiveNumber(first.amount, "首笔金额"),
      required(first.expected_payment_date, "首笔付款日期"),
      required(first.category, "首笔付款类别"),
      required(first.content, "首笔付款事由"),
      required(first.payment_method, "首笔付款方式")
    ]);
    if (firstErrorText) return firstErrorText;
    if (!this.data.firstPaymentAttachments.length) {
      return "已开启首笔预付款，请先上传首笔付款附件";
    }
    return "";
  },

  async submitDirect() {
    if (this.data.submitting) return;
    if (!this.validateFlowFields()) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const form = this.data.directForm;
      const amount = Number(this.data.amountInput || 0);
      const payee = this.data.selectedDirectPayee;
      const contractId = Number(form.contract_id || 0);
      const contract = contractId > 0
        ? (this.data.contracts || []).find((item) => Number(item.id) === contractId)
        : null;
      const created = await request({
        method: "POST",
        path: "/api/v1/payment",
        data: {
          contract_id: form.contract_id !== null ? Number(form.contract_id) : undefined,
          project_id: Number(form.project_id),
          payee_id: Number(form.payee_id),
          expected_payment_date: form.expected_payment_date,
          category: form.category,
          amount,
          content: form.content,
          payment_method: form.payment_method,
          attachments_json: serializeAttachments(this.data.directPaymentAttachments),
          remark: form.remark || undefined
        }
      });
      const paymentId = created && created.data ? Number(created.data.id || 0) : 0;
      if (!paymentId) throw new Error("付款单创建失败");

      await request({
        method: "POST",
        path: `/api/v1/payment/${paymentId}/submit-approval`,
        data: {
          biz_summary: buildDirectPaymentSummary({ form, amount, payee, contract }),
          instance_config: { note: "阈值内直接付款" }
        }
      });

      wx.hideLoading();
      wx.showToast({ title: "提交成功", icon: "success" });
      this.setData({ currentStep: 0 });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    } catch {
      wx.hideLoading();
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async submitContractFlow() {
    if (this.data.submitting) return;
    if (!this.validateFlowFields()) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const amount = Number(this.data.amountInput || 0);
      const contractForm = this.data.contractForm;
      const first = this.data.firstPaymentForm;

      const contractRes = await request({
        method: "POST",
        path: "/api/v1/contract",
        data: {
          direction: "outbound",
          project_id: Number(contractForm.project_id),
          entity_id: Number(contractForm.entity_id),
          counterparty: (() => {
            const payee = this.data.payees.find((item) => Number(item.id) === Number(contractForm.payee_id));
            return payee ? payee.name : "";
          })(),
          contract_type: contractForm.contract_type,
          handler_userid: contractForm.handler_userid,
          contract_date: contractForm.contract_date,
          total_amount: amount,
          attachments_json: serializeAttachments(this.data.contractAttachments),
          remark: contractForm.remark || undefined
        }
      });

      const contractId = contractRes && contractRes.data ? Number(contractRes.data.id || 0) : 0;
      if (!contractId) throw new Error("合同创建失败");

      let paymentId = 0;
      if (this.data.withFirstPayment) {
        const paymentRes = await request({
          method: "POST",
          path: "/api/v1/payment",
          data: {
            contract_id: contractId,
            project_id: Number(contractForm.project_id),
            payee_id: Number(contractForm.payee_id),
            expected_payment_date: first.expected_payment_date,
            category: first.category,
            amount: Number(first.amount || 0),
            content: first.content,
            payment_method: first.payment_method,
            attachments_json: serializeAttachments(this.data.firstPaymentAttachments),
            remark: first.remark || undefined
          }
        });
        paymentId = paymentRes && paymentRes.data ? Number(paymentRes.data.id || 0) : 0;
      }

      await request({
        method: "POST",
        path: `/api/v1/contract/${contractId}/submit-approval`,
        data: {
          biz_summary: "智能发单台-超阈值合同创建",
          instance_config: { note: "超阈值付款自动走合同审批" }
        }
      });

      if (paymentId) {
        await request({
          method: "POST",
          path: `/api/v1/payment/${paymentId}/submit-approval`,
          data: {
            biz_summary: "智能发单台-首笔预付款",
            instance_config: { note: "合同创建后同步发起首笔付款" }
          }
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: "提交成功",
        icon: "success"
      });
      this.setData({ currentStep: 0 });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    } catch {
      wx.hideLoading();
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
