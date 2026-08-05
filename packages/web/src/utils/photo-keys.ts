/**
 * 解析以 JSON 数组形式存储的照片 key 列表（photo_keys_json）。
 *
 * 兼容两种写法，避免历史/多端数据差异导致预览整体失效：
 * 1. 纯字符串数组 ["fuel-application/xxx.jpg"]（网页端与小程序当前写法）；
 * 2. 对象数组 [{ file_key, file_name }]（其余附件字段的通用写法）。
 *
 * 非法 JSON、非数组、空元素一律丢弃，并按出现顺序去重。
 */
const normalizeKey = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const extractKey = (item: unknown): string => {
  const direct = normalizeKey(item);
  if (direct) return direct;
  if (!item || typeof item !== "object") return "";
  const row = item as { file_key?: unknown; key?: unknown };
  return normalizeKey(row.file_key) || normalizeKey(row.key);
};

export const parsePhotoKeys = (raw: string | null | undefined): string[] => {
  if (!raw || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of parsed) {
      const key = extractKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
    return result;
  } catch {
    return [];
  }
};

export const countPhotoKeys = (raw: string | null | undefined): number =>
  parsePhotoKeys(raw).length;
