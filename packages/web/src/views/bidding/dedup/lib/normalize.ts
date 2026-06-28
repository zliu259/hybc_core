// 全角→半角（含全角空格），统一小写，去除所有标点与空白分隔符；保留数字与中英文。
export function normalizeText(input: string): string {
  const folded = input
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
  return folded.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}
