/** 资料的查询：列表、目录树、某台设备适用的资料、详情（带历史版本）。 */
import type { Env } from "../../types/env";
import type { DocCategory, DocFile } from "../../types/wh";
import type { Paged } from "../warehouse/device";
import { WarehouseError } from "../warehouse/errors";
import { requireEnum, requireId } from "../warehouse/validation";
import { DOC_CATEGORIES } from "./file-types";

export type DocScope = "device" | "category" | "general";
export type DocValidity = "expired" | "soon" | "ok" | "none";

export interface DocFileRow extends DocFile {
  device_code: string | null;
  device_name: string | null;
  /** 归属的设备类别的名字（不是资料类别）；只有归到类别的资料有 */
  category_name: string | null;
  scope: DocScope;
  /** 有没有被一个没删除的新版本替换 */
  is_latest: boolean;
  /** 有效期相对北京时间的今天 */
  validity: DocValidity;
}

export interface DocTree {
  total: number;
  general: number;
  categories: {
    category_id: number;
    category_name: string;
    /** 归到这个类别本身的资料数 */
    own: number;
    devices: { device_id: number; device_code: string; name: string; count: number }[];
  }[];
}

type RawRow = DocFile & {
  device_code: string | null;
  device_name: string | null;
  category_name: string | null;
  is_latest: number;
};

const EXPIRING_DAYS = 30;
const MAX_HISTORY = 50;

/** 没被一个没删除的新版本替换。f 是 doc_file 的别名。 */
const IS_LATEST = `NOT EXISTS (SELECT 1 FROM doc_file n WHERE n.supersedes_id = f.id AND n.deleted_at IS NULL)`;

const SELECT_DOC = `SELECT f.*, d.device_code, d.name AS device_name, c.name AS category_name,
    (${IS_LATEST}) AS is_latest
  FROM doc_file f
  LEFT JOIN device d ON d.id = f.device_id
  LEFT JOIN device_category c ON c.id = f.device_category_id`;

const beijingDay = (offsetDays = 0): string =>
  new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);

const validityOf = (validUntil: string | null): DocValidity => {
  if (!validUntil) return "none";
  if (validUntil < beijingDay()) return "expired";
  return validUntil <= beijingDay(EXPIRING_DAYS) ? "soon" : "ok";
};

const scopeOf = (row: Pick<DocFile, "device_id" | "device_category_id">): DocScope =>
  row.device_id !== null ? "device" : row.device_category_id !== null ? "category" : "general";

const toRow = (row: RawRow): DocFileRow => ({
  ...row,
  file_size: Number(row.file_size),
  scope: scopeOf(row),
  is_latest: Number(row.is_latest) === 1,
  validity: validityOf(row.valid_until)
});

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listDocFiles = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<DocFileRow>> => {
  const where: string[] = ["f.deleted_at IS NULL"];
  const params: (string | number)[] = [];
  if (query.include_history !== "1") where.push(IS_LATEST);
  if (query.device_id) {
    where.push("f.device_id = ?");
    params.push(requireId(query.device_id, "设备"));
  }
  if (query.device_category_id) {
    where.push("f.device_category_id = ?");
    params.push(requireId(query.device_category_id, "设备类别"));
  }
  if (query.scope === "general") {
    where.push("f.device_id IS NULL AND f.device_category_id IS NULL");
  }
  if (query.doc_category) {
    where.push("f.doc_category = ?");
    params.push(requireEnum(query.doc_category, "资料类别", DOC_CATEGORIES));
  }
  if (query.validity === "expiring") {
    where.push("f.valid_until IS NOT NULL AND f.valid_until <= ?");
    params.push(beijingDay(EXPIRING_DAYS));
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("(f.title LIKE ? OR f.file_name LIKE ? OR d.device_code LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = ` WHERE ${where.join(" AND ")}`;
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `${SELECT_DOC}${whereSql} ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<RawRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM doc_file f LEFT JOIN device d ON d.id = f.device_id${whereSql}`
    )
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return {
    items: (rows.results ?? []).map(toRow),
    total: Number(count?.n ?? 0),
    page,
    pageSize
  };
};

/** 已删除的查不到。history 是它替换掉的旧版，新的在前。 */
export const getDocFile = async (
  env: Env,
  id: number
): Promise<(DocFileRow & { history: DocFileRow[] }) | null> => {
  const load = (docId: number) =>
    env.DB.prepare(`${SELECT_DOC} WHERE f.id = ?`).bind(docId).first<RawRow>();
  const row = await load(id);
  if (!row || row.deleted_at !== null) return null;
  const history: DocFileRow[] = [];
  let previousId = row.supersedes_id;
  while (previousId !== null && history.length < MAX_HISTORY) {
    const previous = await load(previousId);
    if (!previous) break;
    if (previous.deleted_at === null) history.push(toRow(previous));
    previousId = previous.supersedes_id;
  }
  return { ...toRow(row), history };
};

/** 目录树上的数字：只数最新版、没删除的；设备只列有资料的。 */
export const getDocTree = async (env: Env): Promise<DocTree> => {
  const live = `f.deleted_at IS NULL AND ${IS_LATEST}`;
  const [totals, own, devices, categories] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN f.device_id IS NULL AND f.device_category_id IS NULL THEN 1 ELSE 0 END) AS general
         FROM doc_file f WHERE ${live}`
    ).first<{ total: number; general: number | null }>(),
    env.DB.prepare(
      `SELECT f.device_category_id AS category_id, COUNT(*) AS n
         FROM doc_file f WHERE ${live} AND f.device_category_id IS NOT NULL
        GROUP BY f.device_category_id`
    ).all<{ category_id: number; n: number }>(),
    env.DB.prepare(
      `SELECT d.id AS device_id, d.device_code, d.name, d.category_id, COUNT(*) AS n
         FROM doc_file f JOIN device d ON d.id = f.device_id
        WHERE ${live}
        GROUP BY d.id ORDER BY d.device_code ASC`
    ).all<{
      device_id: number;
      device_code: string;
      name: string;
      category_id: number;
      n: number;
    }>(),
    env.DB.prepare("SELECT id, name FROM device_category ORDER BY sort_order ASC, id ASC").all<{
      id: number;
      name: string;
    }>()
  ]);
  const ownByCategory = new Map((own.results ?? []).map((row) => [row.category_id, Number(row.n)]));
  const deviceRows = devices.results ?? [];
  return {
    total: Number(totals?.total ?? 0),
    general: Number(totals?.general ?? 0),
    categories: (categories.results ?? [])
      .map((category) => ({
        category_id: category.id,
        category_name: category.name,
        own: ownByCategory.get(category.id) ?? 0,
        devices: deviceRows
          .filter((row) => row.category_id === category.id)
          .map((row) => ({
            device_id: row.device_id,
            device_code: row.device_code,
            name: row.name,
            count: Number(row.n)
          }))
      }))
      .filter((category) => category.own > 0 || category.devices.length > 0)
  };
};

const SCOPE_RANK: Record<DocScope, number> = { device: 0, category: 1, general: 2 };
/** 平时：先看说明书和参数。 */
const DEFAULT_ORDER: DocCategory[] = ["manual", "params", "cert", "report", "maintenance", "other"];
/** 干检查、维修、保养的活：保养维修记录和说明书排前面。 */
const WORK_ORDER: DocCategory[] = ["maintenance", "manual", "params", "report", "cert", "other"];
const WORK_KINDS = new Set(["inspection", "maintenance", "servicing"]);

/** 这台设备的、它的类别的、通用的，越具体越靠前。 */
export const listDocsForDevice = async (
  env: Env,
  deviceId: number,
  taskKind?: string
): Promise<DocFileRow[]> => {
  const device = await env.DB.prepare("SELECT id, category_id FROM device WHERE id = ?")
    .bind(deviceId)
    .first<{ id: number; category_id: number }>();
  if (!device) throw new WarehouseError(404, "设备不存在");
  const rows = await env.DB.prepare(
    `${SELECT_DOC}
      WHERE f.deleted_at IS NULL AND ${IS_LATEST}
        AND (f.device_id = ? OR f.device_category_id = ?
             OR (f.device_id IS NULL AND f.device_category_id IS NULL))`
  )
    .bind(deviceId, device.category_id)
    .all<RawRow>();
  const order = taskKind && WORK_KINDS.has(taskKind) ? WORK_ORDER : DEFAULT_ORDER;
  return (rows.results ?? [])
    .map(toRow)
    .sort(
      (a, b) =>
        SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope] ||
        order.indexOf(a.doc_category) - order.indexOf(b.doc_category) ||
        b.created_at.localeCompare(a.created_at) ||
        b.id - a.id
    );
};
