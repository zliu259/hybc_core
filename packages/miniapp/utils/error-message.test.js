const assert = require("assert");

const {
  localizeErrorMessage,
  localizeNetworkErrorMessage,
  localizeLoginErrorMessage,
  hasChinese
} = require("./error-message");

const CJK = /[一-鿿]/;
const hasEnglishWord = (text) => /[A-Za-z]{3,}/.test(text);

// ── 核心契约：输出永远是中文，永远不是空串 ──
const assertChinese = (value, label) => {
  assert.ok(value, `${label} 不能为空`);
  assert.ok(CJK.test(value), `${label} 必须包含中文，实际：${value}`);
  assert.ok(!hasEnglishWord(value), `${label} 不应残留英文单词，实际：${value}`);
};

// 精确表
assert.strictEqual(localizeErrorMessage("Forbidden", 403), "没有权限执行该操作");
assert.strictEqual(localizeErrorMessage("Invalid file key", 400), "文件标识无效");
assert.strictEqual(
  localizeErrorMessage("Envelope changed concurrently; please refresh and retry", 409),
  "报销信封已被他人修改，请刷新后重试"
);

// 句式规则 + 名词表
assert.strictEqual(localizeErrorMessage("Contract not found", 404), "合同不存在");
assert.strictEqual(localizeErrorMessage("Payee not found or inactive", 404), "收款方不存在或已停用");
assert.strictEqual(localizeErrorMessage("Section not found in this project", 404), "当前项目下找不到该标段");
assert.strictEqual(localizeErrorMessage("contract_id is required", 400), "请填写关联合同");
assert.strictEqual(
  localizeErrorMessage("warehouse_id, asset_type_id, quantity are required", 400),
  "请填写仓库、资产类型、数量"
);
assert.strictEqual(localizeErrorMessage("amount must be > 0", 400), "金额必须大于 0");
assert.strictEqual(localizeErrorMessage("tax_rate must be >= 0", 400), "税率不能为负数");
assert.strictEqual(
  localizeErrorMessage("payee_id must be a positive integer", 400),
  "收款方编号必须是正整数"
);

// request.js 自造的报错也必须中文化
assertChinese(localizeErrorMessage("Request failed (500)", 500), "HTTP 500");
assertChinese(localizeErrorMessage("No available API endpoint", 0), "无可用节点");

// 名词表覆盖不到时落 HTTP 状态兜底，仍是中文
assertChinese(localizeErrorMessage("Something totally unmapped happened", 400), "未知 400");
assertChinese(localizeErrorMessage("Something totally unmapped happened", 500), "未知 500");
assertChinese(localizeErrorMessage("", 404), "空文案");
assertChinese(localizeErrorMessage(null, undefined), "null 文案");

// 后端已返回中文时原样保留，但夹带的英文字段名要换成中文
assert.strictEqual(localizeErrorMessage("合同金额不能为负", 400), "合同金额不能为负");
assert.strictEqual(localizeErrorMessage("issue_index 无效", 400), "问题序号 无效");
// 未知 token（单号一类）不能被误改
assert.strictEqual(
  localizeErrorMessage("单号 PAY-20260101-001 已存在", 409),
  "单号 PAY-20260101-001 已存在"
);

// ── 网络层 errMsg ──
assert.strictEqual(localizeNetworkErrorMessage("request:fail timeout"), "请求超时，请检查网络后重试");
assert.strictEqual(
  localizeNetworkErrorMessage("request:fail -102:net::ERR_CONNECTION_REFUSED"),
  "无法连接服务器，请稍后重试"
);
assert.strictEqual(localizeNetworkErrorMessage("request:fail"), "网络请求失败，请检查网络后重试");
// 端能力失败（选文件/录音）不该被说成网络问题
assert.strictEqual(localizeNetworkErrorMessage("startRecord:fail"), "操作失败，请稍后重试");
assertChinese(localizeNetworkErrorMessage(""), "空 errMsg");
assertChinese(localizeNetworkErrorMessage("request:fail ssl hand shake error"), "证书失败");

// ── 登录链路 ──
assertChinese(localizeLoginErrorMessage("WeCom api forbidden, e=48002"), "48002");
assertChinese(localizeLoginErrorMessage("invalid code, e=40029"), "40029");
assertChinese(localizeLoginErrorMessage(""), "空登录报错");
assertChinese(localizeLoginErrorMessage("wx.login failed"), "wx.login 失败");

assert.strictEqual(hasChinese("abc"), false);
assert.strictEqual(hasChinese("中文"), true);

console.log("error-message.test.js passed");

// ── 非网络类 errMsg（选文件/授权/取消）不能被误报成网络失败 ──
assert.strictEqual(localizeNetworkErrorMessage("chooseMedia:fail cancel"), "已取消操作");
assert.strictEqual(
  localizeNetworkErrorMessage("getLocation:fail auth deny"),
  "操作未获授权，请在企业微信中开启对应权限后重试"
);
assert.strictEqual(
  localizeNetworkErrorMessage("chooseFile:fail not supported"),
  "当前客户端不支持该操作，请升级企业微信后重试"
);

// ── rawErrorText：能力探测拿的必须是英文原文，不是中文化后的文案 ──
const { rawErrorText } = require("./error-message");
assert.strictEqual(rawErrorText({ errMsg: "chooseFile:fail cancel" }), "chooseFile:fail cancel");
assert.strictEqual(rawErrorText("chooseFile:fail local file"), "chooseFile:fail local file");
const localizedErr = new Error("请求超时，请检查网络后重试");
localizedErr.__rawErrMsg = "request:fail timeout";
assert.strictEqual(rawErrorText(localizedErr), "request:fail timeout");
assert.strictEqual(rawErrorText(null), "");

console.log("error-message.test.js (extended) passed");
