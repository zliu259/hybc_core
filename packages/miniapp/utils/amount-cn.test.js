const assert = require("assert");

const { toChineseAmount, formatAmount } = require("./amount-cn");

// 写法口径与 API services/amount-cn.ts、web utils/amount-cn.ts 一致（PR #13，owner 定）：
// 每四位一级，级末尾的零不写，其余一个或连续几个零只写一个「零」；
// 万位是零而千位不是零时不写「零」，元位是零而角位不是零时不写「零」；
// 角位是零而分位不是零时元后写「零」；到元为止写「整」。
const cases = [
  // 线上写错的单据（PM-20261102-0003）
  [107750.91, "壹拾万柒仟柒佰伍拾元玖角壹分"],
  // 尾零不写
  [0, "零元整"],
  [1, "壹元整"],
  [10, "壹拾元整"],
  [120, "壹佰贰拾元整"],
  [1000, "壹仟元整"],
  [5600, "伍仟陆佰元整"],
  [100000, "壹拾万元整"],
  [240000, "贰拾肆万元整"],
  [246400, "贰拾肆万陆仟肆佰元整"],
  [2600000, "贰佰陆拾万元整"],
  // 内部连续零合并为一个零
  [105, "壹佰零伍元整"],
  [1001, "壹仟零壹元整"],
  [1010, "壹仟零壹拾元整"],
  [1409.5, "壹仟肆佰零玖元伍角"],
  [127010.44, "壹拾贰万柒仟零壹拾元肆角肆分"],
  // 跨万：低一级不足四位时补零，千位非零时不补
  [10001, "壹万零壹元整"],
  [10200, "壹万零贰佰元整"],
  [100500, "壹拾万零伍佰元整"],
  [200400, "贰拾万零肆佰元整"],
  [240040, "贰拾肆万零肆拾元整"],
  [107000.53, "壹拾万柒仟元伍角叁分"],
  [1000001, "壹佰万零壹元整"],
  [1001000, "壹佰万壹仟元整"],
  [10005000, "壹仟万伍仟元整"],
  // 跨亿
  [100000000, "壹亿元整"],
  [100000001, "壹亿零壹元整"],
  [100001000, "壹亿零壹仟元整"],
  [100010000, "壹亿零壹万元整"],
  [120000000, "壹亿贰仟万元整"],
  [1234567890.12, "壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元壹角贰分"],
  [1000000000000, "壹万亿元整"],
  // 只有角分时不写元
  [0.01, "壹分"],
  [0.5, "伍角"],
  [0.12, "壹角贰分"],
  // 角位是零而分位不是零时元后写零
  [100.05, "壹佰元零伍分"],
  [16409.02, "壹万陆仟肆佰零玖元零贰分"],
  [100.5, "壹佰元伍角"],
  [1680.32, "壹仟陆佰捌拾元叁角贰分"],
  // 四舍五入到分，两位小数不受浮点误差影响
  [0.999, "壹元整"],
  [0.004, "零元整"],
  [1.15, "壹元壹角伍分"],
  [4.35, "肆元叁角伍分"]
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

// 三份实现分属三个包，只能靠比对防止再次漂移。Node 能直接加载 ts（22.18 起默认支持）时才比对
let webImpl = null;
try {
  webImpl = require("../../web/src/utils/amount-cn.ts").toChineseAmount;
} catch (error) {
  console.log(`跳过与 web 实现的比对：${error.message}`);
}
if (webImpl) {
  const amounts = cases.map(([amount]) => amount);
  let seed = 20261106;
  for (let i = 0; i < 5000; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    amounts.push((seed % 10 ** (i % 10)) / 100);
  }
  amounts.forEach((amount) => {
    assert.strictEqual(toChineseAmount(amount), webImpl(amount), `与 web 不一致：${amount}`);
  });
  [Number.NaN, -1, Number.MAX_SAFE_INTEGER].forEach((amount) => {
    assert.strictEqual(toChineseAmount(amount), webImpl(amount), `与 web 不一致：${amount}`);
  });
}

console.log("amount-cn.test.js passed");
