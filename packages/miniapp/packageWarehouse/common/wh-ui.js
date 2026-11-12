/** 库房分包各页面共用的小动作：提示、确认框、输入框、当前的人、人名。 */
const { getUserProfile } = require("../../utils/auth");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const { whGet } = require("./wh-api");

const toast = (title) => wx.showToast({ title, icon: "none" });

/** request 抛出的 message 已经是中文。 */
const errorText = (error, fallback = "操作失败，请稍后重试") => (error && error.message) || fallback;

/** 409：别人先改了，或者业务上现在不能这么做。提示后要重新加载。 */
const isConflict = (error) => Number(error && error.__statusCode) === 409;
const isNotFound = (error) => Number(error && error.__statusCode) === 404;

/**
 * 确认框。
 * @param {{ title: string, content?: string, confirmText?: string, cancelText?: string }} options
 * @returns {Promise<boolean>}
 */
const confirmModal = ({ title, content = "", confirmText = "确定", cancelText = "取消" }) =>
  new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText,
      success: (result) => resolve(Boolean(result && result.confirm)),
      fail: () => resolve(false)
    });
  });

/**
 * 带输入框的弹窗。点取消返回 null，否则返回去掉首尾空白的文字（可能是空串）。
 * @param {{ title: string, placeholder?: string }} options
 * @returns {Promise<string | null>}
 */
const promptModal = ({ title, placeholder = "" }) =>
  new Promise((resolve) => {
    wx.showModal({
      title,
      editable: true,
      placeholderText: placeholder,
      success: (result) =>
        resolve(result && result.confirm ? String(result.content || "").trim() : null),
      fail: () => resolve(null)
    });
  });

/**
 * 当前的人：企微 userid、角色、库房权限。
 * @returns {Promise<{ userid: string, roles: string[], caps: object }>}
 */
const loadViewer = async () => {
  const result = await whGet("/me");
  // 先发请求再读本地的用户信息：从企微卡片冷启动时，登录是在第一次请求里完成的，
  // 请求之前读到的是空的，会把执行人当成旁观者
  const profile = getUserProfile() || {};
  return {
    userid: String(profile.username || ""),
    roles: Array.isArray(profile.roles) ? profile.roles : [],
    caps: (result && result.data) || {}
  };
};

/** userid → 姓名；通讯录里没有就显示 userid。 */
const loadNameOf = async () => {
  const map = await loadUserNameMap();
  return (userid) => (userid ? toUserName(userid, map, String(userid)) : "");
};

/**
 * 只有"知道了"一个按钮的提示框：要人看到才往下走的话用它，不用 toast。
 * @param {{ title: string, content?: string }} options
 * @returns {Promise<void>}
 */
const alertModal = ({ title, content = "" }) =>
  new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      showCancel: false,
      confirmText: "知道了",
      success: () => resolve(),
      fail: () => resolve()
    });
  });

/** 页面参数里的正整数 id；不是就返回 null。 */
const queryId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

module.exports = {
  toast,
  errorText,
  isConflict,
  isNotFound,
  confirmModal,
  alertModal,
  promptModal,
  loadViewer,
  loadNameOf,
  queryId
};
