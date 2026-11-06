const { getUserProfile } = require("../../utils/auth");

const APPROVAL_QUERY_ENTRY = {
  title: "🔀 流程查询",
  desc: "查全部审批流程走到哪一步、在等谁处理",
  path: "/packageTools/query-approval/index"
};

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const BASE_ENTRIES = [
  { title: "📄 合同查询", desc: "查看全部合同并按申请人/时间/项目筛选", path: "/pages/query-contract/index" },
  { title: "💸 付款查询", desc: "查看全部付款并按申请人/时间/项目筛选", path: "/pages/query-payment/index" },
  { title: "🧾 收款查询", desc: "查看全部收款并按申请人/时间/项目筛选", path: "/pages/query-receipt/index" }
];

Page({
  data: {
    entries: BASE_ENTRIES
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    // 流程查询只给超级管理员，别的角色看不到这个入口
    this.setData({
      entries: roles.includes("super_admin")
        ? [...BASE_ENTRIES, APPROVAL_QUERY_ENTRY]
        : BASE_ENTRIES
    });
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    wx.navigateTo({ url: path });
  }
});
