const { request, buildUrl } = require("../../utils/request");
const { getToken, getUserProfile } = require("../../utils/auth");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");

Page({
  data: {
    id: 0,
    loading: false,
    detailState: "loading",
    detailErrorText: "",
    acting: false,
    detail: null,
    bizDetail: null,
    detailAttachments: [],
    reimbursementItemRows: [],
    detailAiReviews: [],
    detailTimelineNodes: [],
    detailRisk: null,
    detailAudit: null,
    transferUsers: [],
    userNameMap: {},
    projectNameMap: {},
    entityNameMap: {},
    paymentEntityList: [],
    paymentEntityLabels: ["请选择付款主体"],
    paymentEntityIndex: 0,
    paymentAccountList: [],
    paymentAccountLabels: ["请选择付款账户"],
    paymentAccountIndex: 0,
    paymentMethodValueOptions: ["", "transfer", "cash", "bill", "other"],
    paymentMethodLabelOptions: ["可后续补充", "对公转账", "现金", "票据", "其他"],
    paymentMethodIndex: 0,
    actionComment: "",
    readOnlyView: false,
    flowCollapsed: true,
    availableActions: [],
    hasAnyAction: false,
    canApprove: false,
    canReject: false,
    canReturn: false,
    canTransfer: false,
    canMoreAction: false,
    userAlreadyActed: false
  },

  onLoad(options) {
    const id = Number((options && options.id) || 0);
    const readOnlyView = Boolean(options && (options.readonly === "1" || options.mode === "readonly"));
    this.setData({ id, readOnlyView });
  },

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  async requestWithRetry(options, retries = 2, delayMs = 220) {
    let lastError = null;
    for (let i = 0; i <= retries; i += 1) {
      try {
        return await request(options);
      } catch (error) {
        lastError = error;
        if (i < retries) {
          await this.delay(delayMs * (i + 1));
        }
      }
    }
    throw lastError || new Error("request failed");
  },

  async onShow() {
    this.setData({ detailState: "loading", detailErrorText: "" });
    await Promise.all([this.loadTransferUsers(), this.loadReferenceData()]);
    await this.loadDetail();
  },

  unknownLabel() {
    return "未匹配";
  },

  toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  },

  projectLabel(projectId) {
    const id = this.toNumber(projectId);
    if (!id) return this.unknownLabel();
    return this.data.projectNameMap[id] || this.unknownLabel();
  },

  entityLabel(entityId) {
    const id = this.toNumber(entityId);
    if (!id) return this.unknownLabel();
    return this.data.entityNameMap[id] || this.unknownLabel();
  },

  userLabel(userId) {
    if (!userId) return this.unknownLabel();
    return this.data.userNameMap[userId] || this.unknownLabel();
  },

  statusLabel(status) {
    const map = {
      pending: "待处理",
      in_progress: "进行中",
      approved: "已通过",
      rejected: "已驳回",
      cancelled: "已取消",
      withdrawn: "已撤回",
      completed: "已完成",
      transferred: "已转签"
    };
    return map[status] || "未知";
  },

  bizTypeLabel(value) {
    const map = {
      outbound_contract: "对外合同审批",
      inbound_contract: "收款合同审批",
      payment_request: "付款审批",
      reimbursement_batch: "报销审批"
    };
    return map[value] || "未知";
  },

  paymentCategoryLabel(value) {
    const map = {
      prepayment: "预付款",
      progress: "进度款",
      settlement: "结算款",
      special_approval: "特殊审批",
      administrative_fee: "行政费",
      labor_fee: "劳务费",
      machinery_fee: "机械费",
      material_fee: "材料费",
      other: "其他费用"
    };
    return map[value] || "未知";
  },

  paymentMethodLabel(value) {
    const map = {
      bank_transfer: "对公转账",
      transfer: "对公转账",
      cash: "现金",
      bill: "票据",
      other: "其他"
    };
    return map[value] || "未知";
  },

  normalizePaymentMethodValue(value) {
    if (!value) return "";
    const raw = String(value).trim();
    const map = {
      bank_transfer: "transfer",
      transfer: "transfer",
      "对公转账": "transfer",
      cash: "cash",
      "现金": "cash",
      bill: "bill",
      "票据": "bill",
      other: "other",
      "其他": "other"
    };
    return map[raw] || "";
  },

  contractDirectionLabel(value) {
    const map = {
      outbound: "对外",
      inbound: "对内"
    };
    return map[value] || "未知";
  },

  contractTypeLabel(value) {
    const map = {
      labor: "人工",
      machine: "机械",
      machinery: "机械",
      general: "总包",
      material: "材料",
      other: "其他"
    };
    return map[value] || "未知";
  },

  actionLabel(action) {
    const map = {
      approve: "通过",
      reject: "驳回",
      transfer: "转签",
      return_initiator: "退回发起人",
      return_prev: "退回上一节点",
      return_to: "退回指定节点",
      withdraw: "撤回",
      cancel: "取消",
      resubmit: "重新提交"
    };
    return map[action] || action || "-";
  },

  aiOutcomeLabel(outcome, comment) {
    if (outcome === "approve") return "建议通过";
    if (outcome === "reject") {
      const text = comment || "";
      return /补充|资料|证据|材料/.test(text) ? "建议补充材料" : "建议拒绝";
    }
    return "-";
  },

  formatBeijingTime(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const yyyy = bj.getUTCFullYear();
    const mm = String(bj.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(bj.getUTCDate()).padStart(2, "0");
    const hh = String(bj.getUTCHours()).padStart(2, "0");
    const mi = String(bj.getUTCMinutes()).padStart(2, "0");
    const ss = String(bj.getUTCSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  },

  formatAmount(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return "0.00";
    const sign = num < 0 ? "-" : "";
    const abs = Math.abs(num);
    const fixed = abs.toFixed(2);
    const parts = fixed.split(".");
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}${intPart}.${parts[1]}`;
  },

  toChineseAmount(value) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";
    if (amount === 0) return "零元整";

    const fractionUnits = ["角", "分"];
    const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const intUnits = ["", "拾", "佰", "仟"];
    const sectionUnits = ["", "万", "亿", "兆"];

    let value100 = Math.round(amount * 100);
    const fraction = value100 % 100;
    let fractionText = "";
    if (fraction === 0) {
      fractionText = "整";
    } else {
      const jiao = Math.floor(fraction / 10);
      const fen = fraction % 10;
      if (jiao > 0) fractionText += `${digit[jiao]}${fractionUnits[0]}`;
      if (fen > 0) fractionText += `${digit[fen]}${fractionUnits[1]}`;
    }

    value100 = Math.floor(value100 / 100);
    let sectionIndex = 0;
    let intText = "";
    while (value100 > 0 && sectionIndex < sectionUnits.length) {
      const sectionValue = value100 % 10000;
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
        intText = `${sectionText}${sectionUnits[sectionIndex]}${intText}`;
      } else if (intText && intText.charAt(0) !== "零") {
        intText = `零${intText}`;
      }
      sectionIndex += 1;
      value100 = Math.floor(value100 / 10000);
    }

    intText = intText.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
    intText = intText.replace(/亿万/g, "亿").replace(/零$/g, "");
    return `${intText || "零"}元${fractionText}`;
  },

  amountDisplay(value, amountCn) {
    const lower = this.formatAmount(value);
    const upper = amountCn || this.toChineseAmount(value);
    return `${lower}（${upper}）`;
  },

  parseAttachments(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => {
          if (typeof item === "string") {
            return { file_key: item, file_name: item, file_size: null };
          }
          if (item && typeof item === "object") {
            const key = item.file_key || item.key;
            if (!key) return null;
            return {
              file_key: key,
              file_name: item.file_name || item.name || key,
              file_size: item.file_size || item.size || null
            };
          }
          return null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  },

  parseAiEmbeddedSummary(summary) {
    if (!summary || typeof summary !== "string") return null;
    const text = summary.trim();
    if (!text.startsWith("{") || !text.endsWith("}")) return null;
    try {
      const parsed = JSON.parse(text);
      return {
        outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
        comment: typeof parsed.comment === "string" ? parsed.comment : null
      };
    } catch {
      return null;
    }
  },

  normalizeAiReviews(rows) {
    return (rows || []).map((row) => {
      const embedded = this.parseAiEmbeddedSummary(row.summary);
      const outcome = row.outcome || (embedded && embedded.outcome) || null;
      const comment = row.comment || (embedded && embedded.comment) || row.summary || "-";
      return {
        ...row,
        statusLabel: this.statusLabel(row.status),
        outcomeLabel: this.aiOutcomeLabel(outcome, comment),
        commentText: comment,
        completedAtText: this.formatBeijingTime(row.completed_at)
      };
    });
  },

  buildTimelineNodes(detail) {
    const nodes = Array.isArray(detail && detail.nodes) ? detail.nodes : [];
    const tasks = Array.isArray(detail && detail.tasks) ? detail.tasks : [];
    const aiMap = new Map();
    this.normalizeAiReviews(detail && detail.ai_gate_reviews).forEach((item) => {
      if (item.node_key) aiMap.set(item.node_key, item);
    });

    return nodes
      .slice()
      .sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        return a.sort_order - b.sort_order;
      })
      .map((node) => {
        const nodeTasks = tasks
          .filter((task) => task.node_instance_id === node.id)
          .map((task) => {
            const aiFallback = task.assignee_userid === "AI_GATE" ? aiMap.get(node.node_key) : null;
            const embedded = this.parseAiEmbeddedSummary(task.comment);
            const aiOutcome = (embedded && embedded.outcome) || task.action;
            const aiComment =
              (embedded && embedded.comment) || task.comment || (aiFallback && aiFallback.commentText) || "";
            const actionLabel =
              task.assignee_userid === "AI_GATE"
                ? this.aiOutcomeLabel(aiOutcome, aiComment)
                : this.actionLabel(task.action);
            return {
              ...task,
              assigneeLabel: this.userLabel(task.assignee_userid),
              actionLabel,
              commentText: aiComment || "-",
              actedAtText: this.formatBeijingTime(task.acted_at)
            };
          });

        return {
          ...node,
          statusLabel: this.statusLabel(node.status),
          tasks: nodeTasks,
          startedAtText: this.formatBeijingTime(node.started_at),
          completedAtText: this.formatBeijingTime(node.completed_at)
        };
      });
  },

  inferAvailableActions(detail) {
    const instanceStatus = detail && detail.instance ? detail.instance.status : "";
    if (instanceStatus !== "pending" && instanceStatus !== "in_progress") {
      return [];
    }

    const explicit = Array.isArray(detail && detail.available_actions)
      ? detail.available_actions.filter((item) => typeof item === "string")
      : [];

    const profile = getUserProfile() || {};
    const userId = (profile.username || profile.id || "").trim();
    const tasks = Array.isArray(detail && detail.tasks) ? detail.tasks : [];
    const nodes = Array.isArray(detail && detail.nodes) ? detail.nodes : [];
    const pendingTasks = tasks.filter((item) => item && item.status === "pending");
    const userPending = userId
      ? pendingTasks.filter((item) => item.assignee_userid === userId)
      : [];

    const currentRound = Number((detail && detail.instance && detail.instance.current_round) || 0);
    const currentNodeKey = (detail && detail.instance && detail.instance.current_node_key) || "";
    const currentNode = nodes.find(
      (item) =>
        item &&
        Number(item.round || 0) === currentRound &&
        String(item.node_key || "") === String(currentNodeKey)
    );
    const currentRoundPending = currentRound
      ? userPending.filter((item) => Number(item.round || 0) === currentRound)
      : userPending;
    const currentNodePending = currentNode
      ? currentRoundPending.filter((item) => Number(item.node_instance_id || 0) === Number(currentNode.id || 0))
      : currentRoundPending;

    if (currentNodePending.length > 0) {
      if (explicit.length > 0) {
        return explicit;
      }
      return ["approve", "reject", "return_initiator", "transfer"];
    }

    const userCompleted = userId
      ? tasks.filter((item) => item.assignee_userid === userId && item.status === "completed")
      : [];
    if (userCompleted.length > 0) {
      return [];
    }

    return [];
  },

  actionFlags(actions) {
    const list = Array.isArray(actions) ? actions : [];
    const canApprove = list.indexOf("approve") >= 0;
    const canReject = list.indexOf("reject") >= 0;
    const canReturn =
      list.indexOf("return_initiator") >= 0 ||
      list.indexOf("return_prev") >= 0 ||
      list.indexOf("return_to") >= 0;
    const canTransfer = list.indexOf("transfer") >= 0;
    return {
      hasAnyAction: canApprove || canReject || canReturn || canTransfer,
      canApprove,
      canReject,
      canReturn,
      canTransfer,
      canMoreAction: canReject || canTransfer
    };
  },

  async loadTransferUsers() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = (((res || {}).data || {}).users || []).filter((item) => item && item.userid);
      const userNameMap = {};
      users.forEach((item) => {
        if (item && item.userid) {
          userNameMap[item.userid] = item.name || item.userid;
        }
      });
      this.setData({ transferUsers: users.slice(0, 50), userNameMap });
    } catch {
      this.setData({ transferUsers: [], userNameMap: {} });
    }
  },

  async loadReferenceData() {
    try {
      const [projectRes, entityRes] = await Promise.all([
        this.requestWithRetry({ method: "GET", path: "/api/v1/project?page=1&pageSize=500" }, 2).catch(() => null),
        this.requestWithRetry({ method: "GET", path: "/api/v1/entity?page=1&pageSize=500" }, 2).catch(() => null)
      ]);

      const projectList = projectRes && Array.isArray(projectRes.data) ? projectRes.data : [];
      const entityList = entityRes && Array.isArray(entityRes.data) ? entityRes.data : [];

      const projectNameMap = {};
      projectList.forEach((item) => {
        if (!item || !item.id) return;
        projectNameMap[item.id] = item.project_name || item.name || this.unknownLabel();
      });

      const entityNameMap = {};
      const paymentEntityList = [];
      entityList.forEach((item) => {
        if (!item || !item.id) return;
        entityNameMap[item.id] = item.entity_name || item.name || this.unknownLabel();
        if ((item.status || "active") === "active") {
          paymentEntityList.push(item);
        }
      });

      const paymentEntityLabels = ["请选择付款主体"].concat(
        paymentEntityList.map((item) => item.entity_name || item.name || `实体${item.id}`)
      );

      this.setData({ projectNameMap, entityNameMap, paymentEntityList, paymentEntityLabels });
    } catch {
      this.setData({
        projectNameMap: {},
        entityNameMap: {},
        paymentEntityList: [],
        paymentEntityLabels: ["请选择付款主体"]
      });
    }
  },

  async loadPaymentAccounts(entityId, preferredAccountId) {
    const targetEntityId = Number(entityId || 0);
    if (!targetEntityId) {
      this.setData({
        paymentAccountList: [],
        paymentAccountLabels: ["请选择付款账户"],
        paymentAccountIndex: 0
      });
      return;
    }
    const res = await this.requestWithRetry({ method: "GET", path: `/api/v1/entity/${targetEntityId}/bank-accounts` }, 2).catch(
      () => null
    );
    const rows = res && Array.isArray(res.data) ? res.data : [];
    const paymentAccountList = rows.filter((item) => (item.status || "active") === "active");
    const paymentAccountLabels = ["请选择付款账户"].concat(
      paymentAccountList.map((item) => `${item.bank_name} / ${item.account_no}`)
    );
    let paymentAccountIndex = 0;
    if (preferredAccountId) {
      const idx = paymentAccountList.findIndex((item) => Number(item.id) === Number(preferredAccountId));
      paymentAccountIndex = idx >= 0 ? idx + 1 : 0;
    }
    this.setData({ paymentAccountList, paymentAccountLabels, paymentAccountIndex });
  },

  async syncPaymentSelectorsFromBizDetail() {
    const detail = this.data.detail;
    const bizDetail = this.data.bizDetail;
    if (!detail || !detail.instance || detail.instance.biz_type !== "payment_request" || !bizDetail) return;

    const entityId = Number(bizDetail.payment_entity_id || 0);
    const accountId = Number(bizDetail.payment_entity_bank_account_id || 0);
    const paymentEntityList = this.data.paymentEntityList || [];
    const entityIndex = entityId
      ? Math.max(
          0,
          paymentEntityList.findIndex((item) => Number(item.id) === entityId) + 1
        )
      : 0;
    const normalizedMethod = this.normalizePaymentMethodValue(bizDetail.payment_method);
    const paymentMethodIndex = Math.max(
      0,
      (this.data.paymentMethodValueOptions || []).indexOf(normalizedMethod)
    );

    this.setData({ paymentEntityIndex: entityIndex, paymentMethodIndex });
    await this.loadPaymentAccounts(entityId, accountId);
  },

  onPaymentEntityChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = index > 0 ? this.data.paymentEntityList[index - 1] : null;
    this.setData({ paymentEntityIndex: index, paymentAccountIndex: 0 });
    this.loadPaymentAccounts(selected ? selected.id : 0, 0);
  },

  onPaymentAccountChange(e) {
    const index = Number(e.detail.value || 0);
    this.setData({ paymentAccountIndex: index });
  },

  onPaymentMethodChange(e) {
    const index = Number(e.detail.value || 0);
    this.setData({ paymentMethodIndex: index });
  },

  getCurrentPaymentSelection() {
    const paymentEntity =
      this.data.paymentEntityIndex > 0
        ? this.data.paymentEntityList[this.data.paymentEntityIndex - 1]
        : null;
    const paymentAccount =
      this.data.paymentAccountIndex > 0
        ? this.data.paymentAccountList[this.data.paymentAccountIndex - 1]
        : null;
    const paymentMethod =
      this.data.paymentMethodValueOptions[this.data.paymentMethodIndex] || "";
    return { paymentEntity, paymentAccount, paymentMethod };
  },

  async savePaymentSelection(options = {}) {
    const detail = this.data.detail;
    const bizDetail = this.data.bizDetail;
    if (!detail || !detail.instance || detail.instance.biz_type !== "payment_request" || !bizDetail) return;

    const { paymentEntity, paymentAccount, paymentMethod } = this.getCurrentPaymentSelection();
    const payload = {};
    if (paymentEntity && paymentEntity.id) {
      payload.payment_entity_id = Number(paymentEntity.id);
    }
    if (paymentAccount && paymentAccount.id) {
      payload.payment_entity_bank_account_id = Number(paymentAccount.id);
      payload.payment_account = `${paymentAccount.bank_name} / ${paymentAccount.account_no}`;
      if (!payload.payment_entity_id && paymentAccount.entity_id) {
        payload.payment_entity_id = Number(paymentAccount.entity_id);
      }
    }
    if (paymentMethod) {
      payload.payment_method = paymentMethod;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const isSuperAdmin = roles.includes("super_admin");

    await request({
      method: "PUT",
      path: `/api/v1/payment/${bizDetail.id}`,
      data: {
        ...payload,
        admin_edit_mode: isSuperAdmin ? true : undefined,
        edit_note: isSuperAdmin ? "miniapp approval payout selection update" : undefined
      }
    });

    if (!options.silent) {
      sayToast({ title: "付款信息已保存", icon: "success" });
      await this.loadDetail();
    }
  },

  async onSavePaymentSelection() {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      await this.savePaymentSelection();
    } catch (error) {
      sayToast({ title: error.message || "保存失败", icon: "none", danger: true });
    } finally {
      this.setData({ acting: false });
    }
  },

  async loadDetail() {
    if (!this.data.id) {
      this.setData({
        loading: false,
        detail: null,
        detailState: "error",
        detailErrorText: "审批单ID无效，请返回列表重试"
      });
      return;
    }
    this.setData({ loading: true, detailState: "loading", detailErrorText: "" });
    try {
      const detailRes = await this.requestWithRetry({ method: "GET", path: `/api/v1/approval/${this.data.id}` }, 2);
      const detail = detailRes && detailRes.data ? detailRes.data : null;
      if (!detail || !detail.instance) throw new Error("审批详情不存在");

      const bizType = detail.instance.biz_type;
      const bizId = detail.instance.biz_id;
      let bizDetail = null;
      let attachments = [];
      let reimbursementItemRows = [];
      let risk = null;
      let audit = null;

      if (bizType === "payment_request") {
         const bizRes = await this.requestWithRetry({ method: "GET", path: `/api/v1/payment/${bizId}` }, 2);
        bizDetail = bizRes && bizRes.data ? bizRes.data : null;
        if (bizDetail) {
          bizDetail = {
            ...bizDetail,
            contractLabel:
              (bizDetail.contract && bizDetail.contract.contract_no) || this.unknownLabel(),
            projectLabel: this.projectLabel(bizDetail.project_id),
            amountDisplay: this.amountDisplay(bizDetail.amount, bizDetail.amount_cn),
            categoryLabel: this.paymentCategoryLabel(bizDetail.category),
            paymentMethodLabel: this.paymentMethodLabel(bizDetail.payment_method)
          };
        }
        attachments = this.parseAttachments(bizDetail && bizDetail.attachments_json);
        const riskRes = await request({ method: "GET", path: `/api/v1/payment/${bizId}/risk-report` }).catch(() => null);
        risk = riskRes && riskRes.data ? riskRes.data : null;
      } else if (bizType === "outbound_contract" || bizType === "inbound_contract") {
         const bizRes = await this.requestWithRetry({ method: "GET", path: `/api/v1/contract/${bizId}` }, 2);
        bizDetail = bizRes && bizRes.data ? bizRes.data : null;
        if (bizDetail) {
          bizDetail = {
            ...bizDetail,
            projectLabel: this.projectLabel(bizDetail.project_id),
            entityLabel: this.entityLabel(bizDetail.entity_id),
            handlerLabel: this.userLabel(bizDetail.handler_userid),
            totalAmountDisplay: this.amountDisplay(bizDetail.total_amount, null),
            paidAmountDisplay: this.amountDisplay(bizDetail.paid_amount, null),
            directionLabel: this.contractDirectionLabel(bizDetail.direction),
            contractTypeLabel: this.contractTypeLabel(bizDetail.contract_type)
          };
        }
        attachments = this.parseAttachments(bizDetail && bizDetail.attachments_json);
      } else if (bizType === "reimbursement_batch") {
         const bizRes = await this.requestWithRetry({ method: "GET", path: `/api/v1/reimbursement/batch/${bizId}` }, 2);
        bizDetail = bizRes && bizRes.data ? bizRes.data : null;
        if (bizDetail) {
          reimbursementItemRows = Array.isArray(bizDetail.items)
            ? bizDetail.items.map((item) => ({
                ...item,
                attachments: Array.isArray(item.attachments) ? item.attachments : [],
                aiReasonabilitySummary:
                  typeof item.ai_reasonability_summary === "string" && item.ai_reasonability_summary.trim()
                    ? item.ai_reasonability_summary.trim()
                    : "-"
              }))
            : [];

          attachments = reimbursementItemRows.flatMap((item) =>
            (item.attachments || []).map((attachment) => ({
              file_key: attachment.file_key,
              file_name: attachment.file_name || attachment.file_key,
              file_size: attachment.file_size,
              envelope_no: item.envelope_no
            }))
          );

          bizDetail = {
            ...bizDetail,
            projectLabel: this.projectLabel(bizDetail.project_id),
            applicantLabel: this.userLabel(bizDetail.applicant_userid),
            totalAmountDisplay: this.amountDisplay(bizDetail.total_amount, null),
            items: reimbursementItemRows
          };
        }
        const auditRes = await request({ method: "GET", path: `/api/v1/reimbursement/batch/${bizId}/audit-report` }).catch(() => null);
        audit = auditRes && auditRes.data ? auditRes.data : null;
      }

      const availableActions = this.inferAvailableActions(detail);
      const flags = this.actionFlags(availableActions);
      const finalFlags = this.data.readOnlyView
        ? {
            hasAnyAction: false,
            canApprove: false,
            canReject: false,
            canReturn: false,
            canTransfer: false,
            canMoreAction: false
          }
        : flags;

      const profile = getUserProfile() || {};
      const userId = (profile.username || profile.id || "").trim();
      const allTasks = Array.isArray(detail.tasks) ? detail.tasks : [];
      const userAlreadyActed = userId
        ? allTasks.some((t) => t.assignee_userid === userId && t.status === "completed")
        : false;

      this.setData({
        detail: {
          ...detail,
          instance: {
            ...detail.instance,
            bizTypeLabel: this.bizTypeLabel(detail.instance.biz_type),
            statusText: this.statusLabel(detail.instance.status),
            initiatorLabel: this.userLabel(detail.instance.initiator_userid),
            submittedAtText: this.formatBeijingTime(detail.instance.submitted_at),
            completedAtText: this.formatBeijingTime(detail.instance.completed_at)
          }
        },
        bizDetail,
        detailRisk: risk,
        detailAudit: audit,
        detailAttachments: attachments,
        reimbursementItemRows,
        detailAiReviews: this.normalizeAiReviews(detail.ai_gate_reviews),
        detailTimelineNodes: this.buildTimelineNodes(detail),
        availableActions: this.data.readOnlyView ? [] : availableActions,
        userAlreadyActed,
        detailState: "ready",
        detailErrorText: "",
        flowCollapsed: true,
        ...finalFlags
      });
      await this.syncPaymentSelectorsFromBizDetail();
    } catch (error) {
      const message = (error && error.message) || "";
      const notFoundLike = /不存在|无权限|not\s*found|permission|403|404/i.test(message);
      const detailErrorText = notFoundLike
        ? "审批详情不存在或无权限"
        : "审批详情加载失败，请稍后重试";
      this.setData({ detail: null, detailState: "error", detailErrorText });
      sayToast({ title: message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  onCommentInput(e) {
    this.setData({ actionComment: e.detail.value || "" });
  },

  async runAction(action) {
    if (this.data.acting || !this.data.id) return;
    if (this.data.readOnlyView) {
      sayToast({ title: "当前为只读视图，不能执行审批操作", icon: "none" });
      return;
    }
    if (!this.data.hasAnyAction) {
      sayToast({ title: "当前节点不可操作", icon: "none" });
      return;
    }
    const comment = (this.data.actionComment || "").trim();
    this.setData({ acting: true });
    wx.showLoading({ title: "处理中...", mask: true });
    try {
      if (action === "approve") {
        if (
          this.data.detail &&
          this.data.detail.instance &&
          this.data.detail.instance.biz_type === "payment_request"
        ) {
          await this.savePaymentSelection({ silent: true });
        }
        await request({ method: "POST", path: `/api/v1/approval/${this.data.id}/approve`, data: { comment } });
      } else if (action === "reject") {
        await request({ method: "POST", path: `/api/v1/approval/${this.data.id}/reject`, data: { comment } });
      } else if (action === "return") {
        await request({
          method: "POST",
          path: `/api/v1/approval/${this.data.id}/return`,
          data: { type: "initiator", comment }
        });
      } else if (action === "transfer") {
        if (!this.data.transferUsers.length) {
          throw new Error("暂无可转签成员");
        }
        const index = await new Promise((resolve, reject) => {
          wx.showActionSheet({
            itemList: this.data.transferUsers.map((item) => `${item.name} (${item.userid})`),
            success: (res) => resolve(Number(res.tapIndex)),
            fail: () => reject(new Error("已取消转签"))
          });
        });
        const selected = this.data.transferUsers[index];
        if (!selected || !selected.userid) throw new Error("未选择有效转签对象");
        await request({
          method: "POST",
          path: `/api/v1/approval/${this.data.id}/transfer`,
          data: { to_userid: selected.userid, reason: comment || "miniapp transfer" }
        });
      }
      vibrateSuccess();
      wx.hideLoading();
      sayToast({ title: "操作成功", icon: "success" });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack();
        } else {
          wx.redirectTo({ url: "/pages/approval/index" });
        }
      }, 800);
    } catch (error) {
      vibrateWarning();
      wx.hideLoading();
      sayToast({ title: error.message || "操作失败", icon: "none", danger: true });
    } finally {
      this.setData({ acting: false });
    }
  },

  onApprove() {
    this.runAction("approve");
  },

  onReject() {
    this.runAction("reject");
  },

  onReturn() {
    this.runAction("return");
  },

  onTransfer() {
    this.runAction("transfer");
  },

  async onMoreAction() {
    if (!this.data.canMoreAction || this.data.acting) return;
    const menu = [];
    if (this.data.canReject) menu.push({ label: "驳回", action: "reject" });
    if (this.data.canTransfer) menu.push({ label: "转签", action: "transfer" });
    if (!menu.length) {
      sayToast({ title: "暂无可用操作", icon: "none" });
      return;
    }
    try {
      const index = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: menu.map((item) => item.label),
          success: (res) => resolve(Number(res.tapIndex)),
          fail: () => reject(new Error("已取消"))
        });
      });
      const picked = menu[index];
      if (!picked) return;
      this.runAction(picked.action);
    } catch {
      return;
    }
  },

  toggleFlowCollapse() {
    this.setData({ flowCollapsed: !this.data.flowCollapsed });
  },

  async openAttachment(e) {
    const fileKey = e.currentTarget.dataset.key;
    const fileName = e.currentTarget.dataset.name || "附件";
    if (!fileKey) return;
    const url = buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);
    const lower = String(fileName).toLowerCase();
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp")
    ) {
      wx.previewImage({ urls: [url], current: url });
      return;
    }
    const token = getToken();
    wx.downloadFile({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          wx.openDocument({ filePath: res.tempFilePath, showMenu: true });
          return;
        }
        sayToast({ title: "附件下载失败", icon: "none", danger: true });
      },
      fail: () => sayToast({ title: "附件下载失败", icon: "none", danger: true })
    });
  },

  goToPendingList() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: "/pages/approval/index" });
    }
  }
});
