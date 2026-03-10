const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage, wxChooseMessageFile } = require("../../utils/wx");
const { firstError, required, positiveNumber } = require("../../utils/validation");
const { getUserProfile } = require("../../utils/auth");

const today = () => new Date().toISOString().slice(0, 10);

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

Page({
  data: {
    loadingMeta: false,
    busy: false,
    checking: false,
    submitting: false,
    thresholdLimit: 10000,
    exceedsThreshold: false,
    amountInput: "",
    amountDisplay: formatAmountDisplay(0),

    payees: [],
    payeeLabels: ["请选择收款方"],
    entities: [],
    entityLabels: ["请选择我方主体"],
    contracts: [],
    contractLabels: ["无合同 / 无需合同"],
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
    withFirstPayment: false,
    firstPaymentForm: {
      amount: "",
      category: "prepayment",
      content: "首笔预付款",
      payment_method: "对公转账",
      expected_payment_date: today(),
      remark: ""
    },

    directContractIndex: 0,
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

    directPaymentAttachments: [],
    contractAttachments: [],
    firstPaymentAttachments: []
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
        request({ method: "GET", path: "/api/v1/admin/thresholds?biz_type=payment_request" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/payment/payee/list" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/contract?direction=outbound&page=1&pageSize=200" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/entity?page=1&pageSize=200" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/auth/wecom/contacts" }).catch(() => null)
      ]);

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
      const contracts = contractRes && Array.isArray(contractRes.data) ? contractRes.data : [];
      const entities = entityRes && Array.isArray(entityRes.data) ? entityRes.data : [];
      const wecomUsers =
        wecomRes && wecomRes.data && Array.isArray(wecomRes.data.users)
          ? wecomRes.data.users.filter((item) => item && item.userid)
          : [];

      this.setData({
        thresholdLimit,
        payees,
        payeeLabels: ["请选择收款方"].concat(
          payees.map((item) => `${item.name} (${item.bank_name || "-"})`)
        ),
        contracts,
        contractLabels: ["无合同 / 无需合同"].concat(
          contracts.map((item) => `${item.contract_no} - ${item.counterparty || "-"}`)
        ),
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
    } finally {
      this.setData({ loadingMeta: false });
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
    this.setData({
      exceedsThreshold,
      amountDisplay: formatAmountDisplay(amount),
      checking: false
    });
  },

  onDirectProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    this.setData({
      directProjectValue: projectId,
      "directForm.project_id": String(projectId || "")
    });
  },

  onContractProjectChange(e) {
    const projectId = Number(e.detail.projectId || 0);
    this.setData({
      contractProjectValue: projectId,
      "contractForm.project_id": String(projectId || "")
    });
  },

  onDirectContractChange(e) {
    const index = Number(e.detail.value || 0);
    const contract = index > 0 ? this.data.contracts[index - 1] : null;
    this.setData({
      directContractIndex: index,
      "directForm.contract_id": contract ? Number(contract.id) : null
    });
  },

  onDirectPayeeChange(e) {
    const index = Number(e.detail.value || 0);
    const payee = index > 0 ? this.data.payees[index - 1] : null;
    this.setData({
      directPayeeIndex: index,
      "directForm.payee_id": payee ? String(payee.id) : ""
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
      "contractForm.payee_id": payee ? String(payee.id) : ""
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
    this.setData({ [`firstPaymentForm.${key}`]: e.detail.value || "" });
  },

  onFirstPaymentToggle(e) {
    this.setData({ withFirstPayment: Boolean(e.detail.value) });
  },

  removeAttachment(e) {
    const group = e.currentTarget.dataset.group;
    const index = Number(e.currentTarget.dataset.index || -1);
    if (index < 0) return;
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
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
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
    if (amount > threshold) {
      return `金额超过阈值 ${threshold.toLocaleString()}，请改走合同流程`;
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
    const errorText = this.validateDirect();
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const form = this.data.directForm;
      const created = await request({
        method: "POST",
        path: "/api/v1/payment",
        data: {
          contract_id: form.contract_id !== null ? Number(form.contract_id) : undefined,
          project_id: Number(form.project_id),
          payee_id: Number(form.payee_id),
          expected_payment_date: form.expected_payment_date,
          category: form.category,
          amount: Number(this.data.amountInput || 0),
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
          biz_summary: "智能发单台-直接付款",
          instance_config: { note: "阈值内直接付款" }
        }
      });

      wx.showToast({ title: "付款申请已提交审批", icon: "success" });
      setTimeout(() => wx.navigateTo({ url: "/pages/approval/index" }), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async submitContractFlow() {
    if (this.data.submitting) return;
    const errorText = this.validateContractFlow();
    if (errorText) {
      wx.showToast({ title: errorText, icon: "none" });
      return;
    }

    this.setData({ submitting: true });
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

      wx.showToast({
        title: paymentId ? "合同+首笔付款已提审" : "合同已提审",
        icon: "success"
      });
      setTimeout(() => wx.navigateTo({ url: "/pages/approval/index" }), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
