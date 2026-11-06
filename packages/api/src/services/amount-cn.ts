// 人民币大写金额，落库口径（payment_request.amount_cn、合同定稿 amount_cn）。
// packages/web/src/utils/amount-cn.ts 是同算法的展示版本，改这里必须同步那边。
// 规则：
// - 每四位一级，级末尾的零不写；其余位置一个或连续几个零只写一个"零"；
// - 万位是零而千位不是零时不写"零"，元位是零而角位不是零时也不写；
// - 角位是零而分位不是零时，元后写"零"；
// - 到元为止写"整"，有角或分不写"整"。
const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = [
  { base: 100000000, name: "亿" },
  { base: 10000, name: "万" },
  { base: 1000, name: "仟" },
  { base: 100, name: "佰" },
  { base: 10, name: "拾" }
];

// 拆成「高位 + 单位 + 低位」：低位为零就不写，低位最高一位是零才补一个"零"。
// 整级为零（如 100001000 的万级）也落在这条规则里。
const convertInteger = (n: number): string => {
  const unit = CN_UNITS.find(({ base }) => n >= base);
  if (!unit) return CN_DIGITS[n];

  const high = convertInteger(Math.floor(n / unit.base)) + unit.name;
  const low = n % unit.base;
  if (low === 0) return high;
  return high + (low < unit.base / 10 ? CN_DIGITS[0] : "") + convertInteger(low);
};

const toCents = (amount: number): number => Math.round(Math.abs(amount) * 100);

export const canConvertAmount = (amount: number): boolean =>
  Number.isFinite(amount) && Number.isSafeInteger(toCents(amount));

export const toAmountChinese = (amount: number): string => {
  // payment 路由的 body 没有运行时校验，字符串金额也会传到这里。
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new TypeError(`toAmountChinese: amount must be a finite number, got ${String(amount)}`);
  }
  if (!canConvertAmount(value)) {
    throw new RangeError(`toAmountChinese: amount out of range, got ${String(amount)}`);
  }

  const cents = toCents(value);
  if (cents === 0) return "零元整";

  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents / 10) % 10;
  const fen = cents % 10;

  const sign = value < 0 ? "负" : "";
  const yuanText = yuan > 0 ? `${convertInteger(yuan)}元` : "";
  if (jiao === 0 && fen === 0) return `${sign}${yuanText}整`;

  const jiaoText = jiao > 0 ? `${CN_DIGITS[jiao]}角` : yuan > 0 ? CN_DIGITS[0] : "";
  const fenText = fen > 0 ? `${CN_DIGITS[fen]}分` : "";
  return `${sign}${yuanText}${jiaoText}${fenText}`;
};
