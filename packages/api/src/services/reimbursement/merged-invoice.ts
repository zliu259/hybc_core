// 判断一个文件里是不是合并了多张发票。查重按「一个文件一个发票号」比，合并文件完全查不到，
// 所以要单独标出来，不能说成「都识别了」。
// 新的识别结果带 invoice_count；老结果只有模型写的摘要，只能从摘要里找，宁可少判不要误判。

const COUNT = "\\d{1,2}|[一两二三四五六七八九十]{1,3}";
const NOT_PART_OF_NUMBER = "(?<![\\d一两二三四五六七八九十])";
const CLAUSE_CHARS = "[^，。；,;张]";

const COUNT_BEFORE_INVOICE = new RegExp(
  `${NOT_PART_OF_NUMBER}(${COUNT})\\s*张${CLAUSE_CHARS}{0,12}发票`,
  "g"
);
// 「发票号码 123 张三」不算：中间不能有「号」和数字
const COUNT_AFTER_INVOICE = new RegExp(`发票[^，。；,;张号\\d]{0,4}(${COUNT})\\s*张`, "g");
const UNCOUNTED_INVOICES = new RegExp(`(?:多|若干|数)张${CLAUSE_CHARS}{0,12}发票`);

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};

const parseCount = (text: string): number => {
  if (/^\d+$/.test(text)) return Number(text);
  if (!text.includes("十")) return CHINESE_DIGITS[text] ?? 0;
  const [tens, ones] = text.split("十");
  return (tens ? (CHINESE_DIGITS[tens] ?? 0) : 1) * 10 + (ones ? (CHINESE_DIGITS[ones] ?? 0) : 0);
};

const labelForCount = (count: number): string | null => (count >= 2 ? `含 ${count} 张发票` : null);

const labelFromSummary = (summary: string): string | null => {
  const matches = [
    ...summary.matchAll(COUNT_BEFORE_INVOICE),
    ...summary.matchAll(COUNT_AFTER_INVOICE)
  ];
  const largest = Math.max(0, ...matches.map((match) => parseCount(match[1])));
  return labelForCount(largest) ?? (UNCOUNTED_INVOICES.test(summary) ? "含多张发票" : null);
};

/** 返回「含 11 张发票」「含多张发票」，不是合并文件时返回 null。只看已完成的识别结果。 */
export const resolveMergedLabel = (extraction: Record<string, unknown> | null): string | null => {
  if (!extraction) return null;
  const declared = extraction.invoice_count;
  if (typeof declared === "number" && Number.isInteger(declared) && declared >= 0) {
    return labelForCount(declared);
  }
  const summary = extraction.raw_text_summary;
  return typeof summary === "string" ? labelFromSummary(summary) : null;
};
