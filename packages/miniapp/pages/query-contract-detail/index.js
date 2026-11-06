const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const { openQueryAttachment } = require("../../utils/attachment-open");
const { buildContractDetailView, buildReceiptRows } = require("../../utils/contract-detail-view");
const {
  canAccessQuery,
  INITIAL_DETAIL_CARD_DATA,
  buildAiState,
  buildApprovalState,
  DETAIL_CARD_TOGGLES
} = require("../../utils/detail-page-common");
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
    receipts: [],
    canOpenReceipt: false,
    ...INITIAL_DETAIL_CARD_DATA
  },

  onLoad(options) {
    const params = options || {};
    const id = Number(params.id || 0);
    // 从审批详情过来的审批人不一定有查询权限，这一路不拦；
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
      const res = await request({ method: "GET", path: `/api/v1/contract/${id}` });
      const contract = res && res.data;
      if (!contract) throw new Error("合同不存在");
      const instanceId = Number(contract.approval_instance_id) || 0;
      // 姓名、收款记录、审批流程取不到都不挡合同本身
      const [userNames, receiptRows, approval] = await Promise.all([
        loadUserNameMap(),
        contract.direction === "inbound"
          ? fetchOptional(`/api/v1/receipt?contract_id=${id}&page=1&pageSize=50`)
          : null,
        instanceId ? fetchOptional(`/api/v1/approval/${instanceId}`) : null
      ]);
      this.setData({
        detail: buildContractDetailView({ contract, userNames }),
        receipts: buildReceiptRows(receiptRows, userNames),
        // 收款详情仍限查询角色，点进去只会被拦，这种情况不给入口
        canOpenReceipt: canAccessQuery(this.currentRoles()),
        remarkEditsOpen: false,
        ...buildAiState({
          approval,
          source: contract.ai_review_result || null,
          status: contract.ai_review_status || "",
          kind: "contract",
          reportTitle: "合同审查报告"
        }),
        ...buildApprovalState({
          approval,
          instanceId,
          userNames,
          fromApproval: this.fromApproval,
          bizRemark: contract.remark
        }),
        detailState: "ready"
      });
    } catch (error) {
      const message = (error && error.message) || "";
      this.setData({
        detail: null,
        detailState: "error",
        detailErrorText: NOT_FOUND_LIKE.test(message) ? "合同不存在或无权限" : "合同详情加载失败，请稍后重试"
      });
    }
  },

  // ── 跳转 ──

  openPaymentDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    const from = this.fromApproval ? "approval" : "contract";
    wx.navigateTo({ url: `/pages/query-payment-detail/index?id=${id}&from=${from}` });
  },

  openReceiptDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id || !this.data.canOpenReceipt) return;
    wx.navigateTo({ url: `/pages/query-receipt-detail/index?id=${id}` });
  },

  openApprovalDetail() {
    const { detail } = this.data;
    if (!detail || !detail.approvalInstanceId) return;
    wx.navigateTo({
      url: `/pages/approval-detail/index?id=${detail.approvalInstanceId}&readonly=1&from=query-contract`
    });
  },

  openAttachment(e) {
    const { key, url, name } = e.currentTarget.dataset;
    return openQueryAttachment({ key, url, name }, "query-contract-detail");
  }
});
