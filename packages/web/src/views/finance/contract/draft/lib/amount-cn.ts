// 人民币金额转中文大写（前端展示用；定稿时以后端 amount-cn 服务为权威）。
// 规则：内部连续零合并为一个"零"、段末零不写、整数补"整"、有角分不补"整"。
const DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const UNITS = ["", "拾", "佰", "仟"];
const BIG_UNITS = ["", "万", "亿", "兆"];

const fourDigitsToChinese = (n: number): string => {
  // n: 0..9999
  let s = "";
  let zeroPending = false;
  for (let i = 3; i >= 0; i--) {
    const p = Math.floor(n / Math.pow(10, i)) % 10;
    if (p === 0) {
      zeroPending = s.length > 0;
    } else {
      if (zeroPending) s += "零";
      s += DIGITS[p] + UNITS[i];
      zeroPending = false;
    }
  }
  return s;
};

export const amountToChinese = (raw: number | string): string => {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(value) || value < 0) return "";
  const rounded = Math.round(value * 100) / 100;
  const yuan = Math.floor(rounded);
  const jiao = Math.floor((rounded * 10) % 10);
  const fen = Math.round(rounded * 100) % 10;

  let integerPart = "";
  if (yuan === 0) {
    integerPart = "零";
  } else {
    // 按每 4 位分段
    const groups: number[] = [];
    let rest = yuan;
    while (rest > 0) {
      groups.push(rest % 10000);
      rest = Math.floor(rest / 10000);
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (g === 0) {
        // 段为零：若后续还有非零段，补一个零（避免连续零由末端 trim 处理）
        if (integerPart.length > 0 && i > 0) integerPart += "零";
        continue;
      }
      const chunk = fourDigitsToChinese(g);
      // 高段的非零段但本段不足 4 位（如 3005 中的 05）需在跨段处补零
      if (integerPart.length > 0 && g < 1000) integerPart += "零";
      integerPart += chunk + BIG_UNITS[i];
    }
  }
  integerPart = integerPart.replace(/零+/g, "零").replace(/零$/, "") || "零";

  let result = integerPart + "元";
  if (jiao === 0 && fen === 0) {
    result += "整";
  } else {
    if (jiao > 0) result += DIGITS[jiao] + "角";
    else if (fen > 0) result += "零";
    if (fen > 0) result += DIGITS[fen] + "分";
  }
  return result;
};
