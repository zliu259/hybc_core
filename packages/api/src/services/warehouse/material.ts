/** 物资档案。数量只能通过库房单改变，这里不碰。 */
import type { Env } from "../../types/env";
import type { Material } from "../../types/wh";
import type { Paged } from "./device";
import { badRequest, WarehouseError } from "./errors";
import { optionalNumber, optionalText, requireEnum, requireId, requireText } from "./validation";

/** 沿用现有配套清单的分节，顺序相同。 */
export const MATERIAL_CATEGORIES = [
  "顶进设备",
  "辅助设备",
  "注浆设备",
  "控制照明系统",
  "测量工具",
  "工具",
  "手动工具",
  "劳动保护",
  "施工消耗材料",
  "生活设施",
  "设备维修配件"
] as const;

const KINDS = ["turnover", "consumable"] as const;
const MONEY_RANGE = { min: 0, max: 100_000_000 };
const nowIso = () => new Date().toISOString();

const isNameSpecConflict = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("UNIQUE constraint failed: material.name, material.spec");

const isCodeConflict = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("UNIQUE constraint failed: material.material_code");

type MaterialColumns = Partial<Record<keyof Material, string | number | null>>;

export const parseMaterialFields = (
  input: Record<string, unknown>,
  mode: "create" | "update"
): MaterialColumns => {
  if ("quantity" in input) throw badRequest("数量只能通过库房单修改");
  const has = (key: string) => mode === "create" || key in input;
  const columns: MaterialColumns = {};
  if (has("name")) columns.name = requireText(input.name, "品名", 50);
  if (has("spec")) columns.spec = optionalText(input.spec, "规格", 80) ?? "";
  if (has("unit")) columns.unit = requireText(input.unit, "单位", 10);
  if (has("category")) columns.category = requireEnum(input.category, "分节", MATERIAL_CATEGORIES);
  if (has("kind")) columns.kind = requireEnum(input.kind, "管法", KINDS);
  if (has("unit_price")) columns.unit_price = optionalNumber(input.unit_price, "单价", MONEY_RANGE);
  if (has("min_stock"))
    columns.min_stock = optionalNumber(input.min_stock, "最低库存", MONEY_RANGE);
  if (has("storage_note")) columns.storage_note = optionalText(input.storage_note, "库位", 50);
  if (has("remark")) columns.remark = optionalText(input.remark, "备注", 300);
  if (mode === "update" && "status" in input) {
    columns.status = requireEnum(input.status, "状态", ["active", "disabled"] as const);
  }
  return columns;
};

export const nextMaterialCode = async (env: Env, offset = 0): Promise<string> => {
  const row = await env.DB.prepare(
    "SELECT MAX(CAST(SUBSTR(material_code, 4) AS INTEGER)) AS n FROM material WHERE material_code GLOB 'WZ-[0-9]*'"
  ).first<{ n: number | null }>();
  return `WZ-${String(Number(row?.n ?? 0) + 1 + offset).padStart(4, "0")}`;
};

export const createMaterial = async (
  env: Env,
  input: Record<string, unknown>
): Promise<{ id: number; material_code: string }> => {
  const columns = parseMaterialFields(input, "create");
  const now = nowIso();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const code = await nextMaterialCode(env);
    const row: MaterialColumns = {
      ...columns,
      material_code: code,
      quantity: 0,
      status: "active",
      created_at: now,
      updated_at: now
    };
    const keys = Object.keys(row) as (keyof Material)[];
    try {
      const result = await env.DB.prepare(
        `INSERT INTO material (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
      )
        .bind(...keys.map((key) => row[key] ?? null))
        .run();
      return { id: Number(result.meta.last_row_id), material_code: code };
    } catch (error) {
      if (isNameSpecConflict(error)) throw new WarehouseError(409, "同品名同规格的物资已存在");
      if (!isCodeConflict(error) || attempt === 1) throw error;
    }
  }
  throw new WarehouseError(409, "物资编号冲突，请重试");
};

export const updateMaterial = async (
  env: Env,
  id: number,
  input: Record<string, unknown>
): Promise<void> => {
  const columns = parseMaterialFields(input, "update");
  const keys = Object.keys(columns) as (keyof Material)[];
  const current = await env.DB.prepare("SELECT id, kind FROM material WHERE id = ?")
    .bind(id)
    .first<{ id: number; kind: Material["kind"] }>();
  if (!current) throw new WarehouseError(404, "物资不存在");
  if (keys.length === 0) return;
  // 周转和消耗记在场数的方式不同，已经有库房单的物资改管法会让在场数永远对不上
  const changesKind = columns.kind !== undefined && columns.kind !== current.kind;
  const kindGuard = changesKind
    ? " AND NOT EXISTS (SELECT 1 FROM wh_doc_line WHERE material_id = ?)"
    : "";
  let changed = 0;
  try {
    const result = await env.DB.prepare(
      `UPDATE material SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = ?${kindGuard}`
    )
      .bind(...keys.map((key) => columns[key] ?? null), nowIso(), id, ...(changesKind ? [id] : []))
      .run();
    changed = Number(result.meta?.changes ?? 0);
  } catch (error) {
    if (isNameSpecConflict(error)) throw new WarehouseError(409, "同品名同规格的物资已存在");
    throw error;
  }
  if (changesKind && changed === 0)
    throw new WarehouseError(409, "这个物资已经有库房单，不能再改管法");
};

export const getMaterial = async (env: Env, id: number): Promise<Material | null> =>
  env.DB.prepare("SELECT * FROM material WHERE id = ?").bind(id).first<Material>();

const LOW_STOCK_SQL = "(m.min_stock IS NOT NULL AND m.quantity <= m.min_stock)";

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listMaterials = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<Material>> => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("(m.material_code LIKE ? OR m.name LIKE ? OR m.spec LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (query.category) {
    where.push("m.category = ?");
    params.push(requireEnum(query.category, "分节", MATERIAL_CATEGORIES));
  }
  if (query.kind) {
    where.push("m.kind = ?");
    params.push(requireEnum(query.kind, "管法", KINDS));
  }
  if (query.status) {
    where.push("m.status = ?");
    params.push(requireEnum(query.status, "状态", ["active", "disabled"] as const));
  }
  if (query.low_stock === "1") where.push(LOW_STOCK_SQL);
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 500);
  const [rows, count] = await Promise.all([
    env.DB.prepare(`SELECT m.* FROM material m${whereSql} ORDER BY m.id ASC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<Material>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM material m${whereSql}`)
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return { items: rows.results ?? [], total: Number(count?.n ?? 0), page, pageSize };
};

/**
 * 库存视图，路径 /warehouse/inventory 和 /alert 是旧 MCP 工具和已发布小程序在用的。
 * 每行多带五个兼容字段，阶段 3 换掉小程序页面后删除。
 */
export type InventoryRow = Omit<Material, "status"> & {
  status: "low" | "normal";
  warehouse_id: number;
  warehouse_name: string;
  asset_type_id: number;
  type_name: string;
};

export const listInventory = async (env: Env, alertOnly: boolean): Promise<InventoryRow[]> => {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.material_code, m.name, m.spec, m.unit, m.category, m.kind, m.quantity, m.unit_price,
            m.min_stock, m.storage_note, m.remark, m.created_at, m.updated_at, ${LOW_STOCK_SQL} AS is_low
       FROM material m
      WHERE m.status = 'active'${alertOnly ? ` AND ${LOW_STOCK_SQL}` : ""}
      ORDER BY m.id ASC`
  ).all<Omit<Material, "status"> & { is_low: number }>();
  return (rows.results ?? []).map(({ is_low: isLow, ...material }) => ({
    ...material,
    warehouse_id: 1,
    warehouse_name: "库房",
    asset_type_id: material.id,
    type_name: material.spec ? `${material.name} ${material.spec}` : material.name,
    status: isLow ? ("low" as const) : ("normal" as const)
  }));
};

export const materialIdFrom = (value: unknown): number => requireId(value, "物资");
