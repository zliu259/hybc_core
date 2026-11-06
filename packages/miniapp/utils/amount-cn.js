/**
 * 金额展示。大写按金额现算，不读接口的 amount_cn：存量和新单里都有写错的值。
 * 规则依据《正确填写票据和结算凭证的基本规定》：
 * - 数字中间的连续零合并为一个「零」，段末（元/万/亿位前）的零不写；
 * - 无角无分补「整」，有角或有分不补；角为零且分非零时元后补「零」。
 */
const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = ["", "拾", "佰", "仟"];
const CN_SECTION_UNITS = ["", "万", "亿", "万亿"];
const INVALID_AMOUNT_TEXT = "金额格式错误";

const toAmountNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

/** 从最高位逐位处理：零先挂起，遇到后续非零数字才落一个「零」，段末挂起的零随段单位丢弃 */
const convertInteger = (integerPart) => {
  const digits = String(integerPart);
  const length = digits.length;
  let result = "";
  let zeroPending = false;
  let sectionHasDigit = false;

  for (let i = 0; i < length; i += 1) {
    const digit = Number(digits[i]);
    const position = length - 1 - i;
    const unitIndex = position % 4;
    const sectionIndex = Math.floor(position / 4);

    if (digit === 0) {
      if (result) zeroPending = true;
    } else {
      if (zeroPending) {
        result += CN_DIGITS[0];
        zeroPending = false;
      }
      result += CN_DIGITS[digit] + CN_UNITS[unitIndex];
      sectionHasDigit = true;
    }

    if (unitIndex === 0) {
      if (sectionIndex > 0 && sectionHasDigit) {
        result += CN_SECTION_UNITS[sectionIndex];
      }
      sectionHasDigit = false;
    }
  }
  return result;
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

  const integerPart = Math.floor(cents / 100);
  const jiao = Math.floor((cents % 100) / 10);
  const fen = cents % 10;
  const yuan = integerPart > 0 ? `${convertInteger(integerPart)}元` : "";

  if (jiao === 0 && fen === 0) return `${yuan}整`;
  const jiaoText = jiao > 0 ? `${CN_DIGITS[jiao]}角` : integerPart > 0 ? CN_DIGITS[0] : "";
  const fenText = fen > 0 ? `${CN_DIGITS[fen]}分` : "";
  return `${yuan}${jiaoText}${fenText}`;
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
