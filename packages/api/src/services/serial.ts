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

  const result = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${columnName} LIKE ?`
  )
    .bind(pattern)
    .first<{ cnt: number }>();

  const seq = String((result?.cnt ?? 0) + 1).padStart(4, "0");
  return `${prefix}-${date}-${seq}`;
};
