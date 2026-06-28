// 按中文/英文句末标点与换行切句，保留句末标点，去空白片段。
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^[。！？；!?;]+$/.test(s));
}
