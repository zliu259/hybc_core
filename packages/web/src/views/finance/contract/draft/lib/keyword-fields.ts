// lib/keyword-fields.ts — 关键字占位符的字段类型判定小工具（编辑控件按类型分流）。

/**
 * 关键字是否为日期类占位符（key 以 `_date` 结尾，如 start_date/end_date/
 * sign_date/delivery_date）。日期类关键字编辑用 el-date-picker，值按
 * "YYYY-MM-DD" 存储，与合同日期格式一致。
 */
export const isDateKey = (key: string): boolean => /_date$/.test(key);
