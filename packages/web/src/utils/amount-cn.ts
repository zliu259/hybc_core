// 人民币大写金额，展示用。落库口径在 packages/api/src/services/amount-cn.ts，
// 两边算法必须一致（amount-cn.test.ts 逐值比对）。规则见 API 那份的文件头。
// 与 API 的差别只有非法输入：页面上显示占位文本，不抛错；负数也算非法。
const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = [
  { base: 100000000, name: "亿" },
  { base: 10000, name: "万" },
  { base: 1000, name: "仟" },
  { base: 100, name: "佰" },
  { base: 10, name: "拾" }
];

const convertInteger = (n: number): string => {
  const unit = CN_UNITS.find(({ base }) => n >= base);
  if (!unit) return CN_DIGITS[n];

  const high = convertInteger(Math.floor(n / unit.base)) + unit.name;
  const low = n % unit.base;
  if (low === 0) return high;
  return (
    high + (low < unit.base / 10 ? CN_DIGITS[0] : "") + convertInteger(low)
  );
};

export const toChineseAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";

  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) return "金额格式错误";
  if (cents === 0) return "零元整";

  const yuan = Math.floor(cents / 100);
  const jiao = Math.floor(cents / 10) % 10;
  const fen = cents % 10;

  const yuanText = yuan > 0 ? `${convertInteger(yuan)}元` : "";
  if (jiao === 0 && fen === 0) return `${yuanText}整`;

  const jiaoText =
    jiao > 0 ? `${CN_DIGITS[jiao]}角` : yuan > 0 ? CN_DIGITS[0] : "";
  const fenText = fen > 0 ? `${CN_DIGITS[fen]}分` : "";
  return `${yuanText}${jiaoText}${fenText}`;
};
