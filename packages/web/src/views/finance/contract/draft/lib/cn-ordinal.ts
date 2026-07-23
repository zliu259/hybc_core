// lib/cn-ordinal.ts — 阿拉伯数字 → 中文数字（合同条款序号「第X条」用，1..99 足够）。
const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1→一, 10→十, 11→十一, 20→二十, 21→二十一……超范围或非正整数原样返回。 */
export const numberToChinese = (n: number): string => {
  if (!Number.isInteger(n) || n <= 0 || n >= 100) return String(n);
  if (n < 10) return DIGITS[n];
  if (n < 20) return n === 10 ? "十" : `十${DIGITS[n - 10]}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${DIGITS[tens]}十${ones ? DIGITS[ones] : ""}`;
};
