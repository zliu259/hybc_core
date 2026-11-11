/**
 * Serial number generation service.
 * Format: {prefix}-{YYYYMMDD}-{0001}
 *
 * Prefixes by business type:
 *   SP → approval (审批)
 *   TK → task (任务)
 *   CT → contract (合同)
 *   PM → payment (付款)
 *   RM → reimbursement (报销)
 *   RC → receipt (收款)
 */

const nowDate = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

/**
 * Generate a serial number for a given business type.
 * Uses COUNT of existing records for the day to determine sequence.
 *
 * @param db - D1Database instance
 * @param prefix - Business prefix (e.g., "SP", "TK")
 * @param tableName - Table to check for existing serials
 * @param columnName - Column containing the serial number
 * @returns Serial number like "SP-20260214-0001"
 */
export const generateSerial = async (
  db: D1Database,
  prefix: string,
  tableName: string,
  columnName: string
): Promise<string> => {
  const date = nowDate();
  const pattern = `${prefix}-${date}-%`;

  const result = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${columnName} LIKE ?`)
    .bind(pattern)
    .first<{ cnt: number }>();

  const seq = String((result?.cnt ?? 0) + 1).padStart(4, "0");
  return `${prefix}-${date}-${seq}`;
};

/**
 * 一次取 count 个连续流水号，格式同 generateSerial。给同一个批处理里要建多条记录的场景用（例如返库一次生成多个检查任务）。
 * 和 generateSerial 一样按当天已有条数计数，并发时可能撞号，调用方要能处理唯一约束失败。
 */
export const generateSerials = async (
  db: D1Database,
  prefix: string,
  tableName: string,
  columnName: string,
  count: number
): Promise<string[]> => {
  const date = nowDate();
  const result = await db
    .prepare(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${columnName} LIKE ?`)
    .bind(`${prefix}-${date}-%`)
    .first<{ cnt: number }>();
  const start = (result?.cnt ?? 0) + 1;
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${date}-${String(start + index).padStart(4, "0")}`
  );
};
