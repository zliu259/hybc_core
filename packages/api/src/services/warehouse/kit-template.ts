/**
 * 配套清单模板（土压平衡、泥水平衡……）。只有库管维护；行在保存时整体替换。
 */
import type { Env } from "../../types/env";
import type { KitTemplate, KitTemplateLine } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, isGuardFailure, releaseGuards } from "./guard";
import { assertCategoriesExist, parseKitLines, type ParsedKitLine } from "./kit-lines";
import { optionalNumber, optionalText, requireEnum, requireText } from "./validation";

/** 读回来的模板行：两个勾选项转成布尔值（库里存 0 和 1）。 */
export interface KitTemplateLineView extends Omit<
  KitTemplateLine,
  "qty_per_set" | "spec_by_diameter"
> {
  qty_per_set: boolean;
  spec_by_diameter: boolean;
  device_category_name: string | null;
}
export type KitTemplateRow = KitTemplate & { line_count: number };

const TEMPLATE_STATUSES = ["active", "disabled"] as const;
const STALE = "数据已变化，请刷新后重试";
const DIAMETER_RANGE = { min: 300, max: 5000, integer: true };

const nowIso = () => new Date().toISOString();

const isNameTaken = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: kit_template.name");

export const requireVersion = (value: unknown): number => {
  const version = optionalNumber(value, "版本号", { min: 0, max: 1_000_000_000, integer: true });
  if (version === null) throw badRequest("缺少版本号，请刷新后重试");
  return version;
};

const insertLine = (
  db: D1Database,
  templateIdSql: string,
  templateIdParam: string | number,
  line: ParsedKitLine,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO kit_template_line
         (template_id, section, sort_order, line_kind, device_category_id, name_text, spec_text, unit, default_qty, note,
          qty_basis, qty_factor, qty_extra, qty_per_set, spec_by_diameter, role, created_at)
       VALUES (${templateIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      templateIdParam,
      line.section,
      line.sort_order,
      line.line_kind,
      line.device_category_id,
      line.name_text,
      line.spec_text,
      line.unit,
      line.qty,
      line.note,
      line.rule.qty_basis,
      line.rule.qty_factor,
      line.rule.qty_extra,
      line.rule.qty_per_set ? 1 : 0,
      line.rule.spec_by_diameter ? 1 : 0,
      line.rule.role,
      now
    );

export const listKitTemplates = async (
  env: Env,
  query: { status?: string }
): Promise<KitTemplateRow[]> => {
  const status = query.status ? requireEnum(query.status, "状态", TEMPLATE_STATUSES) : null;
  const rows = await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM kit_template_line l WHERE l.template_id = t.id) AS line_count
       FROM kit_template t
      ${status ? "WHERE t.status = ?" : ""}
      ORDER BY t.status ASC, t.name ASC`
  )
    .bind(...(status ? [status] : []))
    .all<KitTemplateRow>();
  return (rows.results ?? []).map((row) => ({ ...row, line_count: Number(row.line_count) }));
};

export const getKitTemplate = async (
  env: Env,
  id: number
): Promise<(KitTemplate & { lines: KitTemplateLineView[] }) | null> => {
  const template = await env.DB.prepare("SELECT * FROM kit_template WHERE id = ?")
    .bind(id)
    .first<KitTemplate>();
  if (!template) return null;
  const lines = await env.DB.prepare(
    `SELECT l.*, c.name AS device_category_name
       FROM kit_template_line l
       LEFT JOIN device_category c ON c.id = l.device_category_id
      WHERE l.template_id = ?
      ORDER BY l.sort_order ASC, l.id ASC`
  )
    .bind(id)
    .all<KitTemplateLine & { device_category_name: string | null }>();
  return {
    ...template,
    lines: (lines.results ?? []).map((line) => ({
      ...line,
      qty_per_set: Number(line.qty_per_set) === 1,
      spec_by_diameter: Number(line.spec_by_diameter) === 1
    }))
  };
};

export const createKitTemplate = async (
  env: Env,
  input: Record<string, unknown>,
  userid: string
): Promise<{ id: number }> => {
  const name = requireText(input.name, "模板名称", 30);
  const diameter = optionalNumber(input.diameter_mm, "管径", DIAMETER_RANGE);
  const lines = parseKitLines(input.lines, "template");
  await assertCategoriesExist(env, lines);
  const now = nowIso();
  try {
    await runAtomicBatch(env.DB, [
      env.DB.prepare(
        `INSERT INTO kit_template (name, machine_type, diameter_mm, remark, status, version, created_by_userid, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 0, ?, ?, ?)`
      ).bind(
        name,
        optionalText(input.machine_type, "机型", 20),
        diameter,
        optionalText(input.remark, "备注", 200),
        userid,
        now,
        now
      ),
      ...lines.map((line) =>
        insertLine(env.DB, "(SELECT id FROM kit_template WHERE name = ?)", name, line, now)
      )
    ]);
  } catch (error) {
    if (isNameTaken(error)) throw new WarehouseError(409, "模板名称已存在");
    throw error;
  }
  const row = await env.DB.prepare("SELECT id FROM kit_template WHERE name = ?")
    .bind(name)
    .first<{ id: number }>();
  return { id: Number(row?.id) };
};

export const updateKitTemplate = async (
  env: Env,
  id: number,
  input: Record<string, unknown>
): Promise<void> => {
  const current = await env.DB.prepare("SELECT * FROM kit_template WHERE id = ?")
    .bind(id)
    .first<KitTemplate>();
  if (!current) throw new WarehouseError(404, "模板不存在");
  const version = requireVersion(input.version);
  if (version !== current.version) throw new WarehouseError(409, STALE);

  const name = "name" in input ? requireText(input.name, "模板名称", 30) : current.name;
  const machineType =
    "machine_type" in input ? optionalText(input.machine_type, "机型", 20) : current.machine_type;
  const remark = "remark" in input ? optionalText(input.remark, "备注", 200) : current.remark;
  const diameter =
    "diameter_mm" in input
      ? optionalNumber(input.diameter_mm, "管径", DIAMETER_RANGE)
      : current.diameter_mm;
  const status =
    "status" in input ? requireEnum(input.status, "状态", TEMPLATE_STATUSES) : current.status;
  const lines = "lines" in input ? parseKitLines(input.lines, "template") : null;
  if (lines) await assertCategoriesExist(env, lines);

  const now = nowIso();
  const statements = [
    assertInBatch(env.DB, "SELECT 1 FROM kit_template WHERE id = ? AND version = ?", [id, version]),
    env.DB.prepare(
      `UPDATE kit_template SET name = ?, machine_type = ?, diameter_mm = ?, remark = ?, status = ?,
         version = version + 1, updated_at = ? WHERE id = ?`
    ).bind(name, machineType, diameter, remark, status, now, id),
    ...(lines
      ? [
          env.DB.prepare("DELETE FROM kit_template_line WHERE template_id = ?").bind(id),
          ...lines.map((line) => insertLine(env.DB, "?", id, line, now))
        ]
      : []),
    releaseGuards(env.DB)
  ];
  try {
    await runAtomicBatch(env.DB, statements);
  } catch (error) {
    if (isGuardFailure(error)) throw new WarehouseError(409, STALE);
    if (isNameTaken(error)) throw new WarehouseError(409, "模板名称已存在");
    throw error;
  }
};
