const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = ["", "拾", "佰", "仟"];
const CN_SECTION_UNITS = ["", "万", "亿", "万亿"];

export const toAmountChinese = (amount: number): string => {
  if (amount < 0) return `负${toAmountChinese(-amount)}`;
  if (amount === 0) return "零元整";

  const rounded = Math.round(amount * 100);
  const integerPart = Math.floor(rounded / 100);
  const decimalPart = rounded % 100;
  const jiao = Math.floor(decimalPart / 10);
  const fen = decimalPart % 10;

  let result = "";

  if (integerPart > 0) {
    result = convertInteger(integerPart) + "元";
  }

  if (jiao === 0 && fen === 0) {
    result += "整";
  } else {
    if (integerPart > 0 && jiao === 0) {
      result += "零";
    }
    if (jiao > 0) {
      result += CN_DIGITS[jiao] + "角";
    }
    if (fen > 0) {
      result += CN_DIGITS[fen] + "分";
    }
  }

  return result;
};

const convertInteger = (n: number): string => {
  if (n === 0) return CN_DIGITS[0];

  let result = "";
  let sectionIndex = 0;
  let needZero = false;

  while (n > 0) {
    const section = n % 10000;
    if (section !== 0) {
      const sectionStr = convertSection(section);
      if (needZero) {
        result = sectionStr + CN_SECTION_UNITS[sectionIndex] + "零" + result;
      } else {
        result = sectionStr + CN_SECTION_UNITS[sectionIndex] + result;
      }
      needZero = false;
    } else {
      needZero = true;
    }
    n = Math.floor(n / 10000);
    sectionIndex++;
  }

  return result;
};

const convertSection = (section: number): string => {
  let result = "";
  let unitIndex = 0;
  let needZero = false;

  while (section > 0) {
    const digit = section % 10;
    if (digit === 0) {
      needZero = true;
    } else {
      if (needZero) {
        result = CN_DIGITS[0] + result;
        needZero = false;
      }
      result = CN_DIGITS[digit] + CN_UNITS[unitIndex] + result;
    }
    section = Math.floor(section / 10);
    unitIndex++;
  }

  return result;
};
