const { getUserProfile } = require("../../utils/auth");

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

Page({
  data: {
    entries: [
      { title: "📄 合同查询", desc: "查看全部合同并按申请人/时间/项目筛选", path: "/pages/query-contract/index" },
      { title: "💸 付款查询", desc: "查看全部付款并按申请人/时间/项目筛选", path: "/pages/query-payment/index" },
      { title: "🧾 收款查询", desc: "查看全部收款并按申请人/时间/项目筛选", path: "/pages/query-receipt/index" }
    ]
  },

  onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
    }
  },

  goTo(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    wx.navigateTo({ url: path });
  }
});
