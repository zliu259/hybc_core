const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { buildAiReportViewModel } = require("../../utils/ai-review");
const {
  buildAiPanel,
  buildNodeNameMap,
  buildTimelineNodes,
  buildWaitText,
  extractStopReason,
  formatBeijingTime
} = require("../../utils/approval-detail-view");
const { openQueryAttachment } = require("../../utils/attachment-open");
const { buildPaymentDetailView } = require("../../utils/payment-detail-view");
const { loadUserNameMap } = require("../../utils/user-names");

const QUERY_ROLES = ["super_admin", "finance", "manager"];
const NOT_FOUND_LIKE = /不存在|无权限|not\s*found|permission|403|404/i;
const NO_AI = { latest: null, earlier: [] };

const canAccessQuery = (roles) => roles.some((role) => QUERY_ROLES.indexOf(role) >= 0);

const fetchOptional = async (path) => {
  const res = await request({ method: "GET", path }).catch(() => null);
  return res && res.data ? res.data : null;
};

const reportRan = (source, status) => Boolean(source) || Boolean(status && status !== "none");

Page({
  data: {
    id: 0,
    detailState: "loading",
    detailErrorText: "",
    detail: null,
    waitText: "",
    stopReasonText: "",
    stopIsReturned: false,
    remarkEditsOpen: false,
    // AI 审查
    aiVisible: false,
    ai: NO_AI,
    aiPassedOpen: false,
    aiEarlierOpen: false,
    aiReportTitle: "",
    aiReportOpen: false,
    aiBizReport: null,
    detailAuditView: null,
    // 审批流程
    timelineNodes: [],
    flowCollapsed: true,
    showApprovalLink: false,
    approvalUnavailable: false
  },

  onLoad(options) {
    const params = options || {};
    const id = Number(params.id || 0);
    // 从审批详情过来的发起人、审批人不一定有查询权限，这一路不拦；
    // 接口本身不按角色限制，直接进查询入口的限制只是入口分流
    this.fromApproval = params.from === "approval";
    // 首次 onShow 必须加载；之后仅在上次失败时重试
    this.needsRefreshOnShow = true;
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    this.setData({ id });
  },

  async onShow() {
    if (!this.data.id) return;
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!this.fromApproval && !canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    // 附件预览（wx.openDocument / previewImage）返回同样触发 onShow：
    // 详情已在手时跳过整轮重复请求；上次失败则借返回时机重试
    if (!this.needsRefreshOnShow && this.data.detailState === "ready") return;
    this.needsRefreshOnShow = false;
    await this.loadDetail();
  },

  buildAiState(payment, risk, approval) {
    const ai = approval
      ? buildAiPanel(approval.ai_gate_reviews, buildNodeNameMap(approval), formatBeijingTime)
      : NO_AI;
    // risk-report 拉取失败时回退付款详情自带的原始字段
    const source = (risk && risk.result) || payment.ai_risk_result || null;
    const status = (risk && risk.status) || payment.ai_risk_status || "";
    const hasReport = reportRan(source, status);
    return {
      ai,
      aiVisible: Boolean(ai.latest) || hasReport,
      aiPassedOpen: false,
      aiEarlierOpen: false,
      aiBizReport: buildAiReportViewModel(source, "payment", status),
      aiReportTitle: hasReport ? "付款风控报告" : "",
      // 有关卡结论时报告折叠；没有时报告就是唯一内容，直接展开
      aiReportOpen: !ai.latest
    };
  },

  buildApprovalState(approval, userNames) {
    if (!approval || !approval.instance) {
      return { waitText: "", stopReasonText: "", stopIsReturned: false, timelineNodes: [], flowCollapsed: true };
    }
    const { instance } = approval;
    const timelineNodes = buildTimelineNodes(approval, {
      user: (id) => (id && userNames[id]) || "未匹配",
      formatTime: formatBeijingTime
    });
    return {
      waitText: buildWaitText(instance, approval.nodes),
      stopReasonText: extractStopReason(timelineNodes, approval),
      stopIsReturned: instance.status === "returned",
      timelineNodes,
      // 驳回/退回时默认展开流程，理由不能藏在折叠层里
      flowCollapsed: instance.status !== "rejected" && instance.status !== "returned"
    };
  },

  async loadDetail() {
    const { id } = this.data;
    if (!id) return;
    this.setData({ detailState: "loading", detailErrorText: "" });
    try {
      const res = await request({ method: "GET", path: `/api/v1/payment/${id}` });
      const payment = res && res.data;
      if (!payment) throw new Error("付款单不存在");
      const instanceId = Number(payment.approval_instance_id) || 0;
      // 姓名、风控报告、审批流程取不到都不挡付款单本身
      const [userNames, risk, approval] = await Promise.all([
        loadUserNameMap(),
        fetchOptional(`/api/v1/payment/${id}/risk-report`),
        instanceId ? fetchOptional(`/api/v1/approval/${instanceId}`) : null
      ]);
      this.setData({
        detail: buildPaymentDetailView({ payment, userNames }),
        remarkEditsOpen: false,
        // 审批详情只对参与人和超管开放，取不到时跳过去也打不开
        showApprovalLink: Boolean(approval) && !this.fromApproval,
        approvalUnavailable: Boolean(instanceId) && !approval,
        ...this.buildAiState(payment, risk, approval),
        ...this.buildApprovalState(approval, userNames),
        detailState: "ready"
      });
    } catch (error) {
      const message = (error && error.message) || "";
      this.setData({
        detail: null,
        detailState: "error",
        detailErrorText: NOT_FOUND_LIKE.test(message) ? "付款单不存在或无权限" : "付款详情加载失败，请稍后重试"
      });
    }
  },

  // ── 折叠与跳转 ──

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

  openAttachment(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "query-payment-detail");
  },

  openApprovalDetail() {
    const { detail } = this.data;
    if (!detail || !detail.approvalInstanceId) return;
    wx.navigateTo({
      url: `/pages/approval-detail/index?id=${detail.approvalInstanceId}&readonly=1&from=query-payment`
    });
  }
});
