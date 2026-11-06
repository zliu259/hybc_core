/**
 * 发单台和付款详情页的大写金额：真实页面代码 + 真实 amount-cn，只替换接口、登录态和 wx。
 * 电脑模拟器登录不通，这里只能检查页面数据，界面仍要真机验证。
 */
const assert = require("assert");
const path = require("path");

const PAYMENT_ID = 55;

let paymentRow = {};

global.wx = {
  showToast: () => {},
  navigateBack: () => {}
};

const stubModule = (file, exports) => {
  const resolved = path.join(__dirname, file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stubModule("request.js", {
  request: async ({ path: url }) => {
    if (url === `/api/v1/payment/${PAYMENT_ID}`) return { data: paymentRow };
    if (url === "/api/v1/auth/wecom/contacts") return { data: { users: [] } };
    if (url.indexOf("/api/v1/project") === 0) return { data: [] };
    throw new Error(`未预期的请求 ${url}`);
  },
  buildUrl: (url) => `https://api.test${url}`
});
stubModule("auth.js", {
  getToken: () => "token",
  getUserProfile: () => ({ username: "me", roles: ["finance"] })
});

const loadPageConfig = (file) => {
  let config = null;
  global.Page = (pageConfig) => {
    config = pageConfig;
  };
  require(file);
  return config;
};

const createPage = (config) => ({
  ...config,
  data: JSON.parse(JSON.stringify(config.data)),
  setData(patch, callback) {
    this.data = { ...this.data, ...patch };
    if (callback) callback();
  }
});

const paymentApplyConfig = loadPageConfig("../packageFinance/payment-apply/index.js");
const paymentDetailConfig = loadPageConfig("../pages/query-payment-detail/index.js");

const loadPaymentDetail = async (row) => {
  paymentRow = { id: PAYMENT_ID, serial_no: "SP-1", status: "paid", ...row };
  const page = createPage(paymentDetailConfig);
  await page.onLoad({ id: String(PAYMENT_ID) });
  await page.onShow();
  return page.data.detail;
};

const run = async () => {
  // ── 发单台：输入金额时的展示 ──
  assert.strictEqual(createPage(paymentApplyConfig).data.amountDisplay, "0.00（零元整）");

  const applyCases = [
    ["200400", "200,400.00（贰拾万零肆佰元整）"],
    ["10005", "10,005.00（壹万零伍元整）"],
    ["100.05", "100.05（壹佰元零伍分）"],
    ["16409.02", "16,409.02（壹万陆仟肆佰零玖元零贰分）"],
    ["0.5", "0.50（伍角）"],
    ["107750", "107,750.00（壹拾万柒仟柒佰伍拾元整）"],
    // 清空输入框回到零，不能留着上一次的大写
    ["", "0.00（零元整）"]
  ];
  for (const [input, expected] of applyCases) {
    const page = createPage(paymentApplyConfig);
    page.onAmountInput({ detail: { value: input } });
    assert.strictEqual(page.data.amountDisplay, expected, `发单台输入 ${JSON.stringify(input)}`);
  }

  // ── 付款详情：按 amount 现算，存量 amount_cn 写错也不显示 ──
  let detail = await loadPaymentDetail({ amount: 100500, amount_cn: "壹拾零万零伍佰零元" });
  assert.strictEqual(detail.amountCn, "壹拾万零伍佰元整");
  assert.strictEqual(detail.amountText, "100,500.00");

  // 接口给字符串也按金额算
  detail = await loadPaymentDetail({ amount: "200400", amount_cn: "贰拾万肆佰元整" });
  assert.strictEqual(detail.amountCn, "贰拾万零肆佰元整");
  assert.strictEqual(detail.amountText, "200,400.00");

  // 零是金额，不是缺金额
  detail = await loadPaymentDetail({ amount: 0, amount_cn: "" });
  assert.strictEqual(detail.amountCn, "零元整");
  assert.strictEqual(detail.amountText, "0.00");

  // 缺金额或脏值时两行都显示 -，不回退到 amount_cn，也不写成 0.00
  for (const row of [{ amount: null }, {}, { amount: "" }, { amount: "abc" }]) {
    detail = await loadPaymentDetail({ ...row, amount_cn: "壹佰元整" });
    assert.strictEqual(detail.amountCn, "-", `缺金额 ${JSON.stringify(row)}`);
    assert.strictEqual(detail.amountText, "-", `缺金额 ${JSON.stringify(row)}`);
  }

  console.log("payment-amount-pages.test.js: ok");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
