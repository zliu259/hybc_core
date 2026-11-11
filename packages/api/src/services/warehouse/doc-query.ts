/** 库房单和物资流水的查询。 */
import type { Env } from "../../types/env";
import type { WhDoc, WhDocLine, WhDocType } from "../../types/wh";
import type { Paged } from "./device";
import { DOC_TYPES } from "./doc-input";
import { optionalDate, requireEnum, requireId } from "./validation";

export type WhDocRow = WhDoc & {
  project_name: string | null;
  to_project_name: string | null;
  reversed_by_doc_no: string | null;
  line_count: number;
};

export type WhDocLineRow = WhDocLine & {
  device_code: string | null;
  device_name: string | null;
  material_name: string | null;
  material_spec: string | null;
  unit: string | null;
};

export type LedgerRow = WhDocLineRow & {
  doc_no: string;
  doc_type: WhDocType;
  occurred_at: string;
  operator_userid: string;
  project_name: string | null;
};

const SELECT_DOC = `SELECT doc.*, p.project_name, tp.project_name AS to_project_name,
    (SELECT r.doc_no FROM wh_doc r WHERE r.reverses_doc_id = doc.id) AS reversed_by_doc_no,
    (SELECT COUNT(*) FROM wh_doc_line l WHERE l.doc_id = doc.id) AS line_count
  FROM wh_doc doc
  LEFT JOIN project p ON p.id = doc.project_id
  LEFT JOIN project tp ON tp.id = doc.to_project_id`;

const SELECT_LINE = `SELECT l.*, d.device_code, d.name AS device_name, m.name AS material_name,
    m.spec AS material_spec, m.unit
  FROM wh_doc_line l
  LEFT JOIN device d ON d.id = l.device_id
  LEFT JOIN material m ON m.id = l.material_id`;

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

const nextDay = (date: string): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
};

export const listWhDocs = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<WhDocRow>> => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.doc_type) {
    where.push("doc.doc_type = ?");
    params.push(requireEnum(query.doc_type, "单据类型", DOC_TYPES));
  }
  if (query.project_id) {
    const projectId = requireId(query.project_id, "项目");
    where.push("(doc.project_id = ? OR doc.to_project_id = ?)");
    params.push(projectId, projectId);
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("doc.doc_no LIKE ?");
    params.push(`%${keyword}%`);
  }
  const from = optionalDate(query.date_from, "开始日期");
  if (from) {
    where.push("doc.occurred_at >= ?");
    params.push(from);
  }
  const to = optionalDate(query.date_to, "结束日期");
  if (to) {
    where.push("doc.occurred_at < ?");
    params.push(nextDay(to));
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `${SELECT_DOC}${whereSql} ORDER BY doc.occurred_at DESC, doc.id DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<WhDocRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM wh_doc doc${whereSql}`)
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return { items: rows.results ?? [], total: Number(count?.n ?? 0), page, pageSize };
};

export const getWhDoc = async (
  env: Env,
  id: number
): Promise<(WhDocRow & { lines: WhDocLineRow[] }) | null> => {
  const doc = await env.DB.prepare(`${SELECT_DOC} WHERE doc.id = ?`).bind(id).first<WhDocRow>();
  if (!doc) return null;
  const lines = await env.DB.prepare(`${SELECT_LINE} WHERE l.doc_id = ? ORDER BY l.id ASC`)
    .bind(id)
    .all<WhDocLineRow>();
  return { ...doc, lines: lines.results ?? [] };
};

export const getMaterialLedger = async (
  env: Env,
  materialId: number,
  query: Record<string, string | undefined>
): Promise<Paged<LedgerRow>> => {
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 50, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `SELECT l.*, d.device_code, d.name AS device_name, m.name AS material_name, m.spec AS material_spec, m.unit,
              doc.doc_no, doc.doc_type, doc.occurred_at, doc.operator_userid, p.project_name
         FROM wh_doc_line l
         JOIN wh_doc doc ON doc.id = l.doc_id
         LEFT JOIN device d ON d.id = l.device_id
         LEFT JOIN material m ON m.id = l.material_id
         LEFT JOIN project p ON p.id = COALESCE(l.project_id, doc.project_id)
        WHERE l.material_id = ?
        ORDER BY doc.occurred_at DESC, l.id DESC
        LIMIT ? OFFSET ?`
    )
      .bind(materialId, pageSize, (page - 1) * pageSize)
      .all<LedgerRow>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM wh_doc_line WHERE material_id = ?")
      .bind(materialId)
      .first<{ n: number }>()
  ]);
  return { items: rows.results ?? [], total: Number(count?.n ?? 0), page, pageSize };
};
