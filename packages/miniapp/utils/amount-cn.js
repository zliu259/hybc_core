/**
 * 金额展示。大写按金额现算，不读接口的 amount_cn：存量里有写错的值。
 * 写法口径与 API services/amount-cn.ts、web utils/amount-cn.ts 一致（测试逐值比对 web）：
 * 每四位一级，级末尾的零不写，其余一个或连续几个零只写一个「零」；
 * 万位是零而千位不是零时不写「零」，元位是零而角位不是零时不写「零」；
 * 角位是零而分位不是零时元后写「零」；到元为止写「整」。
 */
const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = [
  { base: 100000000, name: "亿" },
  { base: 10000, name: "万" },
  { base: 1000, name: "仟" },
  { base: 100, name: "佰" },
  { base: 10, name: "拾" }
];
const INVALID_AMOUNT_TEXT = "金额格式错误";

const toAmountNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const convertInteger = (n) => {
  const unit = CN_UNITS.find(({ base }) => n >= base);
  if (!unit) return CN_DIGITS[n];

  const high = convertInteger(Math.floor(n / unit.base)) + unit.name;
  const low = n % unit.base;
  if (low === 0) return high;
  return high + (low < unit.base / 10 ? CN_DIGITS[0] : "") + convertInteger(low);
};

/**
 * @param {unknown} value 元，接口可能给数字或字符串
 * @returns {string} 非法输入返回「金额格式错误」，不抛错，页面不能因脏值崩掉
 */
const toChineseAmount = (value) => {
  const amount = toAmountNumber(value);
  if (amount === null || amount < 0) return INVALID_AMOUNT_TEXT;

  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) return INVALID_AMOUNT_TEXT;
  if (cents === 0) return "零元整";

  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents / 10) % 10;
  const fen = cents % 10;
  const yuanText = yuan > 0 ? `${convertInteger(yuan)}元` : "";

  if (jiao === 0 && fen === 0) return `${yuanText}整`;
  const jiaoText = jiao > 0 ? `${CN_DIGITS[jiao]}角` : yuan > 0 ? CN_DIGITS[0] : "";
  const fenText = fen > 0 ? `${CN_DIGITS[fen]}分` : "";
  return `${yuanText}${jiaoText}${fenText}`;
};

/**
 * @param {unknown} value 元
 * @returns {string} 千分位两位小数；缺值或脏值返回「-」，不能显示成 0.00 冒充金额
 */
const formatAmount = (value) => {
  const amount = toAmountNumber(value);
  if (amount === null) return "-";
  const sign = amount < 0 ? "-" : "";
  const parts = Math.abs(amount).toFixed(2).split(".");
  return `${sign}${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${parts[1]}`;
};

module.exports = { toChineseAmount, formatAmount };
