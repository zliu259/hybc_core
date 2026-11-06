const { request, buildUrl } = require("../../utils/request");
const { amountChangeAttachments } = require("../../utils/amount-change-view");
const { getToken, getUserProfile } = require("../../utils/auth");
const { sayToast, vibrateSuccess, vibrateWarning } = require("../../utils/interaction");
const {
  canEditReturnedApproval,
  isBizRecordCancelled,
  getReturnedApprovalEditRoute
} = require("../../utils/returned-approval");
const { buildAiReportViewModel, buildAuditReportView } = require("../../utils/ai-review");
const {
  QUICK_COMMENTS,
  validateDecisionComment,
  buildConfirmCopy,
  resolveActions,
  resolveFooterMode,
  toPayoutSnapshot,
  isPayoutDirty,
  normalizePaymentMethodValue,
  buildPayoutPayload,
  buildPayoutSummary,
  pickNextPending,
  nextPendingToast
} = require("../../utils/approval-decision");
const {
  formatBeijingTime,
  buildAiPanel,
  buildNodeNameMap,
  buildBizView,
  buildReimbursementItemRows,
  buildTimelineNodes,
  groupTimelineRounds,
  shouldExpandFlow,
  extractStopReason,
  parseAttachments,
  withFileSizeText
} = require("../../utils/approval-detail-view");

const PENDING_LIST_ROUTE = "pages/approval/index";
const PAYOUT_BIZ_TYPES = ["payment_request", "reimbursement_batch"];
const ENTITY_PLACEHOLDER = "请选择付款主体";
const ACCOUNT_PLACEHOLDER = "请选择付款账户";
const TOAST_BEFORE_NAVIGATE_MS = 800;
const COMMENT_BLUR_DELAY_MS = 180;

const accountLabel = (account) => `${account.bank_name} / ${account.account_no}`;

/** 审批人想看业务单全貌时的入口；发起人、审批人不一定有查询权限，所以带上来源 */
const buildBizDetailLink = (bizType, bizDetail) => {
  if (!bizDetail) return null;
  if (bizType === "payment_request") {
    return { label: "查看付款单", url: `/pages/query-payment-detail/index?id=${bizDetail.id}&from=approval` };
  }
  const contractId =
    bizType === "contract_amount_change"
      ? bizDetail.contract && bizDetail.contract.id
      : (bizType === "outbound_contract" || bizType === "inbound_contract") && bizDetail.id;
  return contractId
    ? { label: "查看合同", url: `/pages/query-contract-detail/index?id=${contractId}&from=approval` }
    : null;
};

Page({
  data: {
    id: 0,
    loading: false,
    detailState: "loading",
    detailErrorText: "",
    readOnlyView: false,
    // 跳到业务单详情：{ label, url }，没有时为 null
    bizDetailLink: null,
    // 头部与明细
    hero: null,
    detailTitle: "",
    detailRows: [],
    remarkEdits: [],
    remarkEditsOpen: false,
    reimbursementItemRows: [],
    detailAttachments: [],
    stopReasonText: "",
    stopIsReturned: false,
    stopIsClosed: false,
    // AI 审查
    ai: { latest: null, earlier: [] },
    aiPassedOpen: false,
    aiEarlierOpen: false,
    aiReportTitle: "",
    aiReportOpen: false,
    aiBizReport: null,
    detailAuditView: null,
    // 审批流程
    detailTimelineNodes: [],
    earlierRounds: [],
    flowRoundLabel: "",
    flowOpenRound: 0,
    flowCollapsed: true,
    // 支付方案
    payoutVisible: false,
    payoutEditorOpen: false,
    payoutSummary: "",
    payoutDirty: false,
    paymentEntityLabels: [ENTITY_PLACEHOLDER],
    paymentEntityIndex: 0,
    paymentAccountLabels: [ACCOUNT_PLACEHOLDER],
    paymentAccountIndex: 0,
    paymentMethodValueOptions: ["", "transfer", "personal_transfer", "cash", "bill", "other"],
    paymentMethodLabelOptions: ["可后续补充", "对公转账", "转账", "现金", "票据", "其他"],
    paymentMethodIndex: 0,
    // 决策
    footerMode: "",
    acting: false,
    pendingAction: "",
    canApprove: false,
    canReject: false,
    canReturn: false,
    canTransfer: false,
    manageActions: [],
    moreActions: [],
    transferLabels: ["请选择转办人"],
    actionComment: "",
    commentError: "",
    commentFocus: false,
    commentFocused: false,
    keyboardHeight: 0,
    quickComments: QUICK_COMMENTS
  },

  onLoad(options) {
    const params = options || {};
    this.setData({
      id: Number(params.id || 0),
      readOnlyView: params.readonly === "1" || params.mode === "readonly"
    });
    // 「我发起的」列表以只读方式进入，那里是发起人撤回、取消的唯一入口
    this.fromInitiated = params.from === "initiated";
    // 从业务单详情过来时不再链回去，避免两页来回叠栈
    this.fromBizDetail = params.from === "query-payment" || params.from === "query-contract";
    // 首次 onShow 必须加载；之后仅在显式标记时整页刷新
    this.needsRefreshOnShow = true;
    this.names = { users: {}, projects: {}, entities: {} };
    this.transferUsers = [];
    this.paymentEntityList = [];
    this.paymentAccountList = [];
    this.payoutBaseline = null;
    this.instance = null;
    this.bizDetail = null;
    this.leaving = false;
  },

  onUnload() {
    clearTimeout(this.commentBlurTimer);
    // 等 toast 期间用户已手动返回时，不能再替换掉别的页面
    clearTimeout(this.navigateTimer);
  },

  async onShow() {
    // 附件预览/文档页（wx.openDocument、previewImage）返回同样触发 onShow：
    // 详情已就绪且无刷新标记时直接跳过，避免整页打回加载态重新加载；
    // 上次加载失败（error）则借返回时机自动重试
    if (!this.needsRefreshOnShow && this.data.detailState === "ready") return;
    this.needsRefreshOnShow = false;
    this.setData({ detailState: "loading", detailErrorText: "" });
    if (this.data.id) {
      await Promise.all([this.loadContacts(), this.loadReferenceData()]);
    }
    await this.loadDetail();
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
        if (i < retries) await this.delay(delayMs * (i + 1));
      }
    }
    throw lastError || new Error("请求失败，请稍后重试");
  },

  currentUser() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    return {
      userId: String(profile.username || profile.id || "").trim(),
      isSuperAdmin: roles.indexOf("super_admin") >= 0
    };
  },

  viewContext() {
    const { users, projects, entities } = this.names;
    const nameOf = (map, id) => (id && map[id]) || "未匹配";
    return {
      user: (id) => nameOf(users, id),
      project: (id) => nameOf(projects, id),
      entity: (id) => nameOf(entities, id),
      formatTime: formatBeijingTime
    };
  },

  // ── 数据加载 ──

  async loadContacts() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = (((res || {}).data || {}).users || []).filter((item) => item && item.userid);
      const { userId } = this.currentUser();
      this.names = {
        ...this.names,
        users: users.reduce((acc, item) => (item.name ? { ...acc, [item.userid]: item.name } : acc), {})
      };
      // 不能转办给自己
      this.transferUsers = users.filter((item) => item.userid !== userId);
      this.setData({
        transferLabels: ["请选择转办人", ...this.transferUsers.map((item) => item.name || "未知人员")]
      });
    } catch {
      // 通讯录取不到只影响姓名显示（显示「未匹配」）和转办，不挡审批
      this.names = { ...this.names, users: {} };
      this.transferUsers = [];
    }
  },

  async loadReferenceData() {
    const fetchList = async (path) => {
      const res = await this.requestWithRetry({ method: "GET", path }, 2).catch(() => null);
      return res && Array.isArray(res.data) ? res.data : [];
    };
    const [projectList, entityList] = await Promise.all([
      fetchList("/api/v1/project?page=1&pageSize=500"),
      fetchList("/api/v1/entity?page=1&pageSize=500")
    ]);
    const toNameMap = (list, ...fields) =>
      list.reduce((acc, item) => {
        if (!item || !item.id) return acc;
        return { ...acc, [item.id]: fields.map((field) => item[field]).find(Boolean) || "未匹配" };
      }, {});
    this.names = {
      ...this.names,
      projects: toNameMap(projectList, "project_name", "name"),
      entities: toNameMap(entityList, "entity_name", "name")
    };
    this.paymentEntityList = entityList.filter((item) => item && item.id && (item.status || "active") === "active");
    this.setData({
      paymentEntityLabels: [
        ENTITY_PLACEHOLDER,
        ...this.paymentEntityList.map((item) => item.entity_name || item.name || `实体${item.id}`)
      ]
    });
  },

  /** 业务详情和 AI 报告。风控/审计报告拉取失败不挡审批，按没有报告处理 */
  async loadBizRecords(instance) {
    const { biz_type: bizType, biz_id: bizId } = instance;
    const fetchData = async (path) => {
      const res = await this.requestWithRetry({ method: "GET", path }, 2);
      return res && res.data ? res.data : null;
    };
    const fetchOptional = async (path) => {
      const res = await request({ method: "GET", path }).catch(() => null);
      return res && res.data ? res.data : null;
    };
    const empty = {
      bizDetail: null,
      attachments: [],
      itemRows: [],
      aiBizReport: null,
      detailAuditView: null,
      aiReportTitle: ""
    };
    const ran = (source, status) => Boolean(source) || Boolean(status && status !== "none");

    if (bizType === "payment_request") {
      const bizDetail = await fetchData(`/api/v1/payment/${bizId}`);
      const risk = await fetchOptional(`/api/v1/payment/${bizId}/risk-report`);
      // risk-report 拉取失败时回退付款详情自带的原始字段
      const source = (risk && risk.result) || (bizDetail && bizDetail.ai_risk_result) || null;
      const status = (risk && risk.status) || (bizDetail && bizDetail.ai_risk_status) || "";
      return {
        ...empty,
        bizDetail,
        attachments: parseAttachments(bizDetail && bizDetail.attachments_json),
        aiBizReport: buildAiReportViewModel(source, "payment", status),
        aiReportTitle: ran(source, status) ? "付款风控报告" : ""
      };
    }
    if (bizType === "outbound_contract" || bizType === "inbound_contract") {
      const bizDetail = await fetchData(`/api/v1/contract/${bizId}`);
      const source = (bizDetail && bizDetail.ai_review_result) || null;
      const status = (bizDetail && bizDetail.ai_review_status) || "";
      return {
        ...empty,
        bizDetail,
        attachments: parseAttachments(bizDetail && bizDetail.attachments_json),
        aiBizReport: buildAiReportViewModel(source, "contract", status),
        aiReportTitle: ran(source, status) ? "合同审查报告" : ""
      };
    }
    if (bizType === "contract_amount_change") {
      const bizDetail = await fetchData(`/api/v1/contract/amount-change/${bizId}`);
      return { ...empty, bizDetail, attachments: amountChangeAttachments(bizDetail) };
    }
    if (bizType === "reimbursement_batch") {
      const bizDetail = await fetchData(`/api/v1/reimbursement/batch/${bizId}`);
      const audit = await fetchOptional(`/api/v1/reimbursement/batch/${bizId}/audit-report`);
      // 附件跟着单据显示，不再单列一份
      return {
        ...empty,
        bizDetail,
        itemRows: buildReimbursementItemRows(bizDetail && bizDetail.items),
        detailAuditView: buildAuditReportView(audit),
        aiReportTitle: ran(audit && audit.result, audit && audit.status) ? "报销批次审计报告" : ""
      };
    }
    return empty;
  },

  async loadDetail() {
    if (!this.data.id) {
      this.setData({
        loading: false,
        hero: null,
        detailState: "error",
        detailErrorText: "审批单编号无效，请返回列表重试"
      });
      return;
    }
    this.setData({ loading: true, detailState: "loading", detailErrorText: "" });
    this.payoutBaseline = null;
    try {
      const detailRes = await this.requestWithRetry({ method: "GET", path: `/api/v1/approval/${this.data.id}` }, 2);
      const detail = detailRes && detailRes.data ? detailRes.data : null;
      if (!detail || !detail.instance) throw new Error("审批详情不存在");
      const { instance } = detail;
      const records = await this.loadBizRecords(instance);
      this.instance = instance;
      this.bizDetail = records.bizDetail;

      const { userId, isSuperAdmin } = this.currentUser();
      const { readOnlyView } = this.data;
      const actions = resolveActions({
        detail,
        userId,
        isSuperAdmin,
        readOnly: readOnlyView,
        allowManageInReadOnly: this.fromInitiated
      });
      const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
      const footerMode = resolveFooterMode({
        hasAnyAction: actions.hasAnyAction,
        manageActions: actions.manageActions,
        // 业务单已作废（如超管作废付款）时不再给「编辑并重新提交」入口，即便实例仍是 returned
        canEditReturnedBusiness:
          canEditReturnedApproval(instance, userId) && !isBizRecordCancelled(records.bizDetail),
        userAlreadyActed: Boolean(userId) && tasks.some((t) => t.assignee_userid === userId && t.status === "completed"),
        readOnly: readOnlyView
      });

      const ctx = this.viewContext();
      const view = buildBizView({ instance, nodes: detail.nodes, bizDetail: records.bizDetail, ctx });
      const ai = buildAiPanel(detail.ai_gate_reviews, buildNodeNameMap(detail), formatBeijingTime);
      const allTimelineNodes = buildTimelineNodes(detail, ctx);
      const flowRounds = groupTimelineRounds(allTimelineNodes, detail);
      const payoutVisible =
        actions.canApprove && Boolean(records.bizDetail) && PAYOUT_BIZ_TYPES.indexOf(instance.biz_type) >= 0;

      this.setData({
        hero: view.hero,
        detailTitle: view.detailTitle,
        detailRows: view.rows,
        remarkEdits: view.remarkEdits,
        remarkEditsOpen: false,
        reimbursementItemRows: records.itemRows,
        detailAttachments: withFileSizeText(records.attachments),
        ai,
        aiPassedOpen: false,
        aiEarlierOpen: false,
        aiBizReport: records.aiBizReport,
        detailAuditView: records.detailAuditView,
        aiReportTitle: records.aiReportTitle,
        // 有关卡结论时报告折叠；没有时报告就是唯一内容，直接展开
        aiReportOpen: !ai.latest,
        detailTimelineNodes: flowRounds.currentNodes,
        earlierRounds: flowRounds.earlier,
        flowRoundLabel: flowRounds.roundLabel,
        flowOpenRound: 0,
        stopReasonText: extractStopReason(
          allTimelineNodes,
          detail,
          records.bizDetail && records.bizDetail.remark,
          ctx
        ),
        stopIsReturned: instance.status === "returned",
        stopIsClosed: instance.status === "cancelled" || instance.status === "withdrawn",
        // 流程停下来（含 AI 拦截退回）或有人写了实际意见时默认展开，不能藏在折叠层里
        flowCollapsed: !shouldExpandFlow(instance.status, flowRounds.currentNodes),
        footerMode,
        canApprove: actions.canApprove,
        canReject: actions.canReject,
        canReturn: actions.canReturn,
        canTransfer: actions.canTransfer,
        manageActions: actions.manageActions,
        moreActions: actions.moreActions,
        payoutVisible,
        payoutEditorOpen: false,
        bizDetailLink: this.fromBizDetail ? null : buildBizDetailLink(instance.biz_type, records.bizDetail),
        detailState: "ready",
        detailErrorText: ""
      });
      if (payoutVisible) await this.syncPayoutFromBizDetail();
    } catch (error) {
      const message = (error && error.message) || "";
      const notFoundLike = /不存在|无权限|not\s*found|permission|403|404/i.test(message);
      this.setData({
        hero: null,
        aiBizReport: null,
        detailAuditView: null,
        detailState: "error",
        detailErrorText: notFoundLike ? "审批详情不存在或无权限" : "审批详情加载失败，请稍后重试"
      });
      sayToast({ title: message || "加载失败", icon: "none", danger: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ── 支付方案 ──

  async loadPaymentAccounts(entityId, preferredAccountId) {
    const targetId = Number(entityId || 0);
    const res = targetId
      ? await this.requestWithRetry({ method: "GET", path: `/api/v1/entity/${targetId}/bank-accounts` }, 2).catch(() => null)
      : null;
    const rows = res && Array.isArray(res.data) ? res.data : [];
    this.paymentAccountList = rows.filter((item) => (item.status || "active") === "active");
    const preferredIndex = preferredAccountId
      ? this.paymentAccountList.findIndex((item) => Number(item.id) === Number(preferredAccountId)) + 1
      : 0;
    this.setData({
      paymentAccountLabels: [ACCOUNT_PLACEHOLDER, ...this.paymentAccountList.map(accountLabel)],
      paymentAccountIndex: preferredIndex
    });
  },

  async syncPayoutFromBizDetail() {
    const { bizDetail } = this;
    const entityId = Number(bizDetail.payment_entity_id || 0);
    const entityIndex = entityId ? this.paymentEntityList.findIndex((item) => Number(item.id) === entityId) + 1 : 0;
    const method = normalizePaymentMethodValue(bizDetail.payment_method);
    this.setData({
      paymentEntityIndex: entityIndex,
      paymentMethodIndex: Math.max(0, this.data.paymentMethodValueOptions.indexOf(method))
    });
    await this.loadPaymentAccounts(entityId, Number(bizDetail.payment_entity_bank_account_id || 0));
    // 基线取同步后的选择器值：停用的主体、账户加载失败都不会被当成改动
    this.payoutBaseline = toPayoutSnapshot(this.currentPayoutSelection());
    this.refreshPayoutState();
  },

  currentPayoutSelection() {
    const { paymentEntityIndex, paymentAccountIndex, paymentMethodIndex, paymentMethodValueOptions } = this.data;
    return {
      paymentEntity: paymentEntityIndex > 0 ? this.paymentEntityList[paymentEntityIndex - 1] : null,
      paymentAccount: paymentAccountIndex > 0 ? this.paymentAccountList[paymentAccountIndex - 1] : null,
      paymentMethod: paymentMethodValueOptions[paymentMethodIndex] || ""
    };
  },

  refreshPayoutState() {
    const { paymentEntityIndex, paymentAccountIndex, paymentMethodIndex } = this.data;
    const payoutDirty = isPayoutDirty(this.payoutBaseline, toPayoutSnapshot(this.currentPayoutSelection()));
    // 账户列表加载失败时选择器是空的，没改动就用单据上的账户文本
    const savedAccount = (!payoutDirty && this.bizDetail && this.bizDetail.payment_account) || "";
    this.setData({
      payoutDirty,
      payoutSummary: buildPayoutSummary({
        methodLabel: paymentMethodIndex > 0 ? this.data.paymentMethodLabelOptions[paymentMethodIndex] : "",
        entityLabel: paymentEntityIndex > 0 ? this.data.paymentEntityLabels[paymentEntityIndex] : "",
        accountLabel: paymentAccountIndex > 0 ? this.data.paymentAccountLabels[paymentAccountIndex] : savedAccount
      })
    });
  },

  togglePayoutEditor() {
    this.setData({ payoutEditorOpen: !this.data.payoutEditorOpen });
  },

  async onPaymentEntityChange(e) {
    const index = Number(e.detail.value || 0);
    const selected = index > 0 ? this.paymentEntityList[index - 1] : null;
    this.setData({ paymentEntityIndex: index, paymentAccountIndex: 0 });
    await this.loadPaymentAccounts(selected ? selected.id : 0, 0);
    // 换主体时默认带上第一个账户，否则只提交主体会和旧账户错配
    if (selected && this.paymentAccountList.length > 0) {
      this.setData({ paymentAccountIndex: 1 });
    }
    this.refreshPayoutState();
  },

  onPaymentAccountChange(e) {
    this.setData({ paymentAccountIndex: Number(e.detail.value || 0) });
    this.refreshPayoutState();
  },

  onPaymentMethodChange(e) {
    this.setData({ paymentMethodIndex: Number(e.detail.value || 0) });
    this.refreshPayoutState();
  },

  /** @returns {Promise<boolean>} 是否真的提交了；选择器全空时没有可提交的内容 */
  async persistPayout() {
    const selection = this.currentPayoutSelection();
    const payload = buildPayoutPayload(selection);
    if (Object.keys(payload).length === 0) return false;
    if (this.instance.biz_type === "payment_request") {
      const { isSuperAdmin } = this.currentUser();
      await request({
        method: "PUT",
        path: `/api/v1/payment/${this.bizDetail.id}`,
        data: {
          ...payload,
          admin_edit_mode: isSuperAdmin ? true : undefined,
          edit_note: isSuperAdmin ? "小程序审批页更新支付信息" : undefined
        }
      });
    } else {
      await request({
        method: "PUT",
        path: `/api/v1/reimbursement/batch/${this.bizDetail.id}/payout-plan`,
        data: payload
      });
    }
    this.payoutBaseline = toPayoutSnapshot(selection);
    this.refreshPayoutState();
    return true;
  },

  async onSavePaymentSelection() {
    if (this.data.acting || !this.data.payoutDirty) return;
    this.setData({ acting: true, pendingAction: "save_payout" });
    try {
      const saved = await this.persistPayout();
      if (!saved) {
        sayToast({ title: "请至少选择支付方式或付款主体", icon: "none" });
        return;
      }
      sayToast({ title: "支付方案已保存", icon: "success" });
      await this.loadDetail();
    } catch (error) {
      sayToast({ title: (error && error.message) || "保存失败，请重试", icon: "none", danger: true });
    } finally {
      this.setData({ acting: false, pendingAction: "" });
    }
  },

  // ── 审批意见 ──

  onCommentInput(e) {
    this.setData({ actionComment: e.detail.value || "", commentError: "" });
  },

  onCommentFocus(e) {
    clearTimeout(this.commentBlurTimer);
    const height = Number((e.detail && e.detail.height) || 0);
    this.setData({ commentFocused: true, keyboardHeight: height || this.data.keyboardHeight });
  },

  onCommentBlur() {
    this.setData({ commentFocus: false, keyboardHeight: 0 });
    // 晚一点再收起快捷意见：点快捷意见时输入框先失焦，立刻收起就点不到了
    this.commentBlurTimer = setTimeout(() => {
      this.setData({ commentFocused: false });
    }, COMMENT_BLUR_DELAY_MS);
  },

  onKeyboardHeightChange(e) {
    this.setData({ keyboardHeight: Number((e.detail && e.detail.height) || 0) });
  },

  onQuickComment(e) {
    clearTimeout(this.commentBlurTimer);
    this.setData({ actionComment: e.currentTarget.dataset.text || "", commentError: "" });
  },

  /** 校验不过时就地报错并聚焦输入框。必须在点击回调里同步设置，iOS 才会弹键盘 */
  checkComment(action) {
    const result = validateDecisionComment(action, this.data.actionComment);
    if (!result.ok) {
      vibrateWarning();
      this.setData({ commentError: result.error, commentFocus: true });
    }
    return result;
  },

  // ── 审批动作 ──

  confirmAction(copy) {
    return new Promise((resolve) => {
      wx.showModal({
        title: copy.title,
        content: copy.content,
        confirmText: copy.confirmText,
        confirmColor: "#d54941",
        cancelText: "再想想",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false)
      });
    });
  },

  postAction(action, data) {
    return request({ method: "POST", path: `/api/v1/approval/${this.data.id}/${action}`, data });
  },

  async runAction(key, work, afterDone) {
    if (this.data.acting || this.leaving) return;
    this.setData({ acting: true, pendingAction: key });
    wx.showLoading({ title: "处理中...", mask: true });
    try {
      await work();
      vibrateSuccess();
      await afterDone();
    } catch (error) {
      vibrateWarning();
      wx.hideLoading();
      // 服务端报错原文展示，审批人才知道该怎么办
      sayToast({ title: (error && error.message) || "操作失败，请重试", icon: "none", danger: true });
    } finally {
      // 准备跳转时保持忙碌态，防止等 toast 期间再点一次
      if (!this.leaving) this.setData({ acting: false, pendingAction: "" });
    }
  },

  /** 处理完打开下一条待办，批量审批不必来回跳列表；没有待办时回列表 */
  async advanceToNext(doneText) {
    let nextId = 0;
    let pendingCount = null;
    try {
      const res = await request({ method: "GET", path: "/api/v1/approval/pending?page=1&pageSize=5" });
      const rows = res && Array.isArray(res.data) ? res.data : [];
      nextId = pickNextPending(rows, this.data.id);
      pendingCount = rows.length;
    } catch {
      // 取不到下一条不影响本次结果，回列表即可；pendingCount 留空，不提示「已处理完」
    }
    wx.hideLoading();
    sayToast({ title: nextPendingToast(doneText, { nextId, pendingCount }), icon: "none" });
    this.leaving = true;
    this.navigateTimer = setTimeout(() => {
      if (nextId) {
        wx.redirectTo({
          url: `/pages/approval-detail/index?id=${nextId}`,
          fail: () => this.goToPendingList()
        });
      } else {
        this.goToPendingList();
      }
    }, TOAST_BEFORE_NAVIGATE_MS);
  },

  async stayAndReload(doneText) {
    wx.hideLoading();
    sayToast({ title: doneText, icon: "none" });
    this.setData({ actionComment: "", commentError: "" });
    await this.loadDetail();
  },

  async onApprove() {
    if (!this.data.canApprove || this.data.acting) return;
    const { comment } = this.checkComment("approve");
    await this.runAction(
      "approve",
      async () => {
        // 没改过就不提交：否则每次审批都往备注写一条「超管修改」日志
        if (this.data.payoutVisible && this.data.payoutDirty) await this.persistPayout();
        await this.postAction("approve", { comment });
      },
      () => this.advanceToNext("已通过")
    );
  },

  async onReject() {
    if (!this.data.canReject || this.data.acting) return;
    const { ok, comment } = this.checkComment("reject");
    if (!ok) return;
    if (!(await this.confirmAction(buildConfirmCopy("reject")))) return;
    await this.runAction(
      "reject",
      () => this.postAction("reject", { comment }),
      () => this.advanceToNext("已驳回")
    );
  },

  async onReturn() {
    if (!this.data.canReturn || this.data.acting) return;
    const { ok, comment } = this.checkComment("return");
    if (!ok) return;
    await this.runAction(
      "return",
      () => this.postAction("return", { type: "initiator", comment }),
      () => this.advanceToNext("已退回")
    );
  },

  async onManage(action) {
    if (this.data.acting) return;
    const { isSuperAdmin } = this.currentUser();
    if (!(await this.confirmAction(buildConfirmCopy(action, { isSuperAdmin })))) return;
    const cancelledText = isSuperAdmin ? "已终止流程" : "已取消审批";
    await this.runAction(
      action,
      () => this.postAction(action, {}),
      () => this.stayAndReload(action === "withdraw" ? "已撤回" : cancelledText)
    );
  },

  onManageAction(e) {
    return this.onManage(e.currentTarget.dataset.action);
  },

  async onMoreAction() {
    const { moreActions, acting } = this.data;
    if (acting || moreActions.length === 0) return;
    const picked = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: moreActions.map((item) => item.label),
        success: (res) => resolve(moreActions[Number(res.tapIndex)] || null),
        fail: () => resolve(null) // 用户点了取消
      });
    });
    if (!picked) return;
    if (picked.action === "transfer") {
      this.openTransferPicker();
      return;
    }
    await this.onManage(picked.action);
  },

  openTransferPicker() {
    if (this.transferUsers.length === 0) {
      sayToast({ title: "通讯录暂不可用，无法转办", icon: "none" });
      return;
    }
    // wx.showActionSheet 最多 6 项放不下通讯录，这里用可搜索列表
    const picker = this.selectComponent("#transferPicker");
    if (picker) picker.open();
  },

  async onTransferPick(e) {
    const selected = this.transferUsers[Number(e.detail.value || 0) - 1];
    if (!selected || this.data.acting) return;
    const ok = await this.confirmAction({
      title: "确定转办？",
      content: `转办给 ${selected.name || "对方"} 后，这笔审批由对方处理。`,
      confirmText: "确定转办"
    });
    if (!ok) return;
    const reason = (this.data.actionComment || "").trim() || "小程序转办";
    await this.runAction(
      "transfer",
      () => this.postAction("transfer", { to_userid: selected.userid, reason }),
      () => this.advanceToNext("已转办")
    );
  },

  goEditReturnedBusiness() {
    const { instance } = this;
    if (!instance) return;
    const route = getReturnedApprovalEditRoute({
      approvalId: instance.id || this.data.id,
      bizType: instance.biz_type,
      bizId: instance.biz_id
    });
    if (!route) {
      sayToast({ title: "该业务暂不支持小程序编辑", icon: "none" });
      return;
    }
    // 编辑重提后返回本页要能看到最新状态，标记下次 onShow 整页刷新
    this.needsRefreshOnShow = true;
    wx.navigateTo({ url: route });
  },

  goToPendingList() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === PENDING_LIST_ROUTE) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: `/${PENDING_LIST_ROUTE}` });
    }
  },

  // ── 折叠与附件 ──

  toggleAiPassed() {
    this.setData({ aiPassedOpen: !this.data.aiPassedOpen });
  },

  toggleAiReport() {
    this.setData({ aiReportOpen: !this.data.aiReportOpen });
  },

  toggleAiEarlier() {
    this.setData({ aiEarlierOpen: !this.data.aiEarlierOpen });
  },

  toggleRemarkEdits() {
    this.setData({ remarkEditsOpen: !this.data.remarkEditsOpen });
  },

  toggleFlowCollapse() {
    this.setData({ flowCollapsed: !this.data.flowCollapsed });
  },

  toggleFlowRound(e) {
    const round = Number(e.currentTarget.dataset.round) || 0;
    this.setData({ flowOpenRound: this.data.flowOpenRound === round ? 0 : round });
  },

  openBizDetail() {
    const { bizDetailLink } = this.data;
    if (bizDetailLink) wx.navigateTo({ url: bizDetailLink.url });
  },

  openAttachment(e) {
    const fileKey = e.currentTarget.dataset.key;
    const fileName = e.currentTarget.dataset.name || "附件";
    if (!fileKey) return;
    const url = buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);
    if (/\.(png|jpe?g|webp)$/i.test(String(fileName))) {
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
  }
});
