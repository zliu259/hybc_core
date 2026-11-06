const assert = require("assert");

const { toChineseAmount, formatAmount } = require("./amount-cn");

// 规则取自《正确填写票据和结算凭证的基本规定》，用例与 API 侧标准规则对齐：
// 段间零要补（壹拾万零伍佰），段末零不写，角为零且分非零时元后补零。
const cases = [
  [246400, "贰拾肆万陆仟肆佰元整"],
  [1000, "壹仟元整"],
  [240040, "贰拾肆万零肆拾元整"],
  [200400, "贰拾万零肆佰元整"],
  [100500, "壹拾万零伍佰元整"],
  [1000001, "壹佰万零壹元整"],
  [100010000, "壹亿零壹万元整"],
  [100.5, "壹佰元伍角"],
  [0, "零元整"],
  [0.01, "壹分"],
  [0.12, "壹角贰分"],
  [1, "壹元整"],
  [10, "壹拾元整"],
  [105, "壹佰零伍元整"],
  [1005, "壹仟零伍元整"],
  [1010, "壹仟零壹拾元整"],
  [100.05, "壹佰元零伍分"],
  [16409.02, "壹万陆仟肆佰零玖元零贰分"],
  [100.55, "壹佰元伍角伍分"],
  // 万位为零、千位不为零时规定两种写法都合法，这里与 API 侧算法同样补零
  [107750.91, "壹拾万零柒仟柒佰伍拾元玖角壹分"],
  [1001000, "壹佰万零壹仟元整"],
  [10005000, "壹仟万零伍仟元整"],
  [240000, "贰拾肆万元整"],
  [100000000, "壹亿元整"],
  [100000001, "壹亿零壹元整"],
  [120000000, "壹亿贰仟万元整"],
  [1234567890.12, "壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元壹角贰分"],
  [0.999, "壹元整"]
];
cases.forEach(([input, expected]) => {
  assert.strictEqual(toChineseAmount(input), expected, `toChineseAmount(${input})`);
});

// 接口金额可能是字符串
assert.strictEqual(toChineseAmount("100500"), "壹拾万零伍佰元整");

// 非法输入只返回占位，页面不能因为一个脏值崩掉
[Number.NaN, Number.POSITIVE_INFINITY, -1, Number.MAX_SAFE_INTEGER, "abc"].forEach((input) => {
  assert.strictEqual(toChineseAmount(input), "金额格式错误", `toChineseAmount(${input})`);
});
// 缺金额和金额为零是两回事
[null, undefined, ""].forEach((input) => {
  assert.strictEqual(toChineseAmount(input), "金额格式错误", `toChineseAmount(${input})`);
});

assert.strictEqual(formatAmount(1234567.5), "1,234,567.50");
assert.strictEqual(formatAmount("107750.91"), "107,750.91");
assert.strictEqual(formatAmount(0), "0.00");
assert.strictEqual(formatAmount(-1200), "-1,200.00");
assert.strictEqual(formatAmount(null), "-");
assert.strictEqual(formatAmount(undefined), "-");
assert.strictEqual(formatAmount(""), "-");
assert.strictEqual(formatAmount("abc"), "-");

console.log("amount-cn.test.js passed");
