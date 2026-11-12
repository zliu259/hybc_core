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
 * @param {{ title: string, content?: string, confirmText?: string }} options
 * @returns {Promise<boolean>}
 */
const confirmModal = ({ title, content = "", confirmText = "确定" }) =>
  new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
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
  const profile = getUserProfile() || {};
  const result = await whGet("/me");
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
  promptModal,
  loadViewer,
  loadNameOf,
  queryId
};
