const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { openQueryAttachment } = require("../../utils/attachment-open");
const {
  canAccessQuery,
  INITIAL_DETAIL_CARD_DATA,
  buildAiState,
  buildApprovalState,
  DETAIL_CARD_TOGGLES
} = require("../../utils/detail-page-common");
const { buildPaymentDetailView } = require("../../utils/payment-detail-view");
const { loadUserNameMap } = require("../../utils/user-names");

const NOT_FOUND_LIKE = /不存在|无权限|not\s*found|permission|403|404/i;

const fetchOptional = async (path) => {
  const res = await request({ method: "GET", path }).catch(() => null);
  return res && res.data ? res.data : null;
};

Page({
  ...DETAIL_CARD_TOGGLES,

  data: {
    id: 0,
    detailState: "loading",
    detailErrorText: "",
    detail: null,
    showContractLink: false,
    ...INITIAL_DETAIL_CARD_DATA
  },

  onLoad(options) {
    const params = options || {};
    const id = Number(params.id || 0);
    // 从审批详情过来的发起人、审批人不一定有查询权限，这一路不拦；
    // 接口本身不按角色限制，直接进查询入口的限制只是入口分流
    this.fromApproval = params.from === "approval";
    // 从合同详情过来时不再链回去，避免两页来回叠栈
    this.fromContract = params.from === "contract";
    // 首次 onShow 必须加载；之后仅在上次失败时重试
    this.needsRefreshOnShow = true;
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    this.setData({ id });
  },

  currentRoles() {
    const profile = getUserProfile() || {};
    return Array.isArray(profile.roles) ? profile.roles : [];
  },

  async onShow() {
    if (!this.data.id) return;
    if (!this.fromApproval && !canAccessQuery(this.currentRoles())) {
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
      const detail = buildPaymentDetailView({ payment, userNames });
      this.setData({
        detail,
        // 合同详情会列出合同下全部付款，范围比这张付款单大，只给查询角色入口（与 Web 一致）
        showContractLink:
          Boolean(detail.contractId) && !this.fromContract && canAccessQuery(this.currentRoles()),
        remarkEditsOpen: false,
        ...buildAiState({
          approval,
          // risk-report 拉取失败时回退付款详情自带的原始字段
          source: (risk && risk.result) || payment.ai_risk_result || null,
          status: (risk && risk.status) || payment.ai_risk_status || "",
          kind: "payment",
          reportTitle: "付款风控报告"
        }),
        ...buildApprovalState({
          approval,
          instanceId,
          userNames,
          fromApproval: this.fromApproval,
          bizRemark: payment.remark
        }),
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

  // ── 跳转 ──

  openAttachment(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "query-payment-detail");
  },

  openContractDetail() {
    const { detail } = this.data;
    if (!detail || !detail.contractId) return;
    wx.navigateTo({ url: `/pages/query-contract-detail/index?id=${detail.contractId}` });
  },

  openApprovalDetail() {
    const { detail } = this.data;
    if (!detail || !detail.approvalInstanceId) return;
    wx.navigateTo({
      url: `/pages/approval-detail/index?id=${detail.approvalInstanceId}&readonly=1&from=query-payment`
    });
  }
});
