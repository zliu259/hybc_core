/**
 * 企微 userid → 中文姓名 的全局映射。
 *
 * 背景：后端身份是企微 userid（拼音串，如 XiaoLianZhong），多个页面把
 * manager_userid / operator_userid 等字段直接渲染上屏，用户看到的就是拼音。
 * 通讯录接口 /api/v1/auth/wecom/contacts 各页此前各拉各的，这里收口成
 * 模块级缓存 + 单飞：一次会话最多请求一次，失败后允许下次重试。
 */
const { request } = require("./request");

const CJK_RE = /[一-鿿]/;

let cachedMap = null;
let inflight = null;

/**
 * 拉取（或复用缓存的）userid → 姓名映射。
 * 失败时返回空映射并清掉单飞句柄，下一次调用会重试，不会把失败缓存住。
 * @returns {Promise<Record<string, string>>}
 */
const loadUserNameMap = () => {
  if (cachedMap) return Promise.resolve(cachedMap);
  if (inflight) return inflight;
  inflight = request({ method: "GET", path: "/api/v1/auth/wecom/contacts" })
    .then((res) => {
      const users = res && res.data && Array.isArray(res.data.users) ? res.data.users : [];
      const map = {};
      users.forEach((item) => {
        if (item && item.userid && item.name) {
          map[item.userid] = item.name;
        }
      });
      cachedMap = map;
      return map;
    })
    .catch(() => ({}))
    .finally(() => {
      inflight = null;
    });
  return inflight;
};

/**
 * 单个 userid 转显示名。
 * - 空值 → "-"
 * - 值本身含中文（存量数据里 userid 字段直接存了中文名）→ 原样
 * - 映射命中 → 中文姓名
 * - 未命中（离职/映射拉取失败）→ fallback，绝不把拼音 id 透给用户
 */
const toUserName = (userid, map, fallback = "未知人员") => {
  const id = String(userid == null ? "" : userid).trim();
  // 旧数据里空申请人存的是占位符 "-"，视同空值
  if (!id || id === "-") return "-";
  // 外部填报放行后 userid 是合成串 "external:<提交人姓名>"（external-log-audit）；
  // 姓名是中文但英文前缀会跟着上屏，这里换成中文标记。
  if (/^external:/i.test(id)) {
    const rest = id.replace(/^external:/i, "").trim();
    return rest ? `外部·${rest}` : "外部人员";
  }
  if (CJK_RE.test(id)) return id;
  const table = map || cachedMap || {};
  if (Object.prototype.hasOwnProperty.call(table, id)) return table[id];
  return fallback;
};

module.exports = {
  loadUserNameMap,
  toUserName
};
