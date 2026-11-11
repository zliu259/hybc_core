/**
 * 项目配套清单的写：建、改、提交、确认、作废。
 * 清单只存计划；已发、已退、报损都从库房单算（project-ledger.ts）。
 */
import type { AuthTokenPayload } from "../../types/auth";
import type { Env } from "../../types/env";
import type { ProjectKit, ProjectKitLine, ProjectKitStatus } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { generateSerials } from "../serial";
import type { WarehouseCapabilities } from "./access";
import { requireProjectId } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, isGuardFailure, releaseGuards } from "./guard";
import { linesFromKit, linesFromTemplate } from "./kit-build";
import {
  assertCategoriesExist,
  assertMaterialsActive,
  parseKitLines,
  type ParsedKitLine
} from "./kit-lines";
import { requireVersion } from "./kit-template";
import { optionalId, optionalText, requireText } from "./validation";

const STALE = "数据已变化，请刷新后重试";
const nowIso = () => new Date().toISOString();

/** 库管、经理任何项目；现场负责人只限自己负责的项目。 */
export const assertCanEditKitFor = async (
  env: Env,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities,
  projectId: number
): Promise<void> => {
  if (caps.is_keeper || auth.roles.includes("manager")) return;
  if (caps.can_create_kit && auth.roles.includes("site_manager")) {
    const project = await env.DB.prepare("SELECT manager_userid FROM project WHERE id = ?")
      .bind(projectId)
      .first<{ manager_userid: string | null }>();
    if (project?.manager_userid && project.manager_userid === auth.sub) return;
    throw new WarehouseError(403, "只能给自己负责的项目建清单");
  }
  throw new WarehouseError(403, "没有建配套清单的权限");
};

const insertKitLine = (
  db: D1Database,
  kitIdSql: string,
  kitIdParam: string | number,
  line: ParsedKitLine,
  now: string
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO project_kit_line
         (kit_id, section, sort_order, line_kind, device_category_id, material_id, name_text, spec_text,
          unit, planned_qty, source, note, created_at)
       VALUES (${kitIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      kitIdParam,
      line.section,
      line.sort_order,
      line.line_kind,
      line.device_category_id,
      line.material_id,
      line.name_text,
      line.spec_text,
      line.unit,
      line.qty ?? 0,
      line.source,
      line.note,
      now
    );

const guardKit = (db: D1Database, id: number, version: number, statuses: readonly string[]) =>
  assertInBatch(
    db,
    `SELECT 1 FROM project_kit WHERE id = ? AND version = ? AND status IN (${statuses.map(() => "?").join(", ")})`,
    [id, version, ...statuses]
  );

const runKitBatch = async (env: Env, statements: D1PreparedStatement[]): Promise<void> => {
  try {
    await runAtomicBatch(env.DB, [...statements, releaseGuards(env.DB)]);
  } catch (error) {
    if (isGuardFailure(error)) throw new WarehouseError(409, STALE);
    throw error;
  }
};

const loadKit = async (env: Env, id: number): Promise<ProjectKit> => {
  const kit = await env.DB.prepare("SELECT * FROM project_kit WHERE id = ?")
    .bind(id)
    .first<ProjectKit>();
  if (!kit) throw new WarehouseError(404, "清单不存在");
  return kit;
};

const checkVersion = (kit: ProjectKit, input: Record<string, unknown>): number => {
  const version = requireVersion(input.version);
  if (version !== kit.version) throw new WarehouseError(409, STALE);
  return version;
};

const loadStoredLines = async (env: Env, kitId: number): Promise<ProjectKitLine[]> =>
  (
    await env.DB.prepare(
      "SELECT * FROM project_kit_line WHERE kit_id = ? ORDER BY sort_order ASC, id ASC"
    )
      .bind(kitId)
      .all<ProjectKitLine>()
  ).results ?? [];

/** 提交和确认前：至少一行；要发的物资行（计划数大于 0）必须选定规格；物资没停用。 */
const assertKitReady = async (env: Env, lines: readonly ProjectKitLine[]): Promise<void> => {
  if (lines.length === 0) throw badRequest("清单还没有任何行");
  lines.forEach((line, index) => {
    if (line.line_kind === "material" && Number(line.planned_qty) > 0 && !line.material_id)
      throw badRequest(`第 ${index + 1} 行：${line.name_text} 还没选规格`);
  });
  await assertMaterialsActive(env, lines);
};

const isKitNoTaken = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: project_kit.kit_no");

export const createProjectKit = async (
  env: Env,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<{ id: number; kit_no: string }> => {
  const projectId = await requireProjectId(env, input.project_id);
  await assertCanEditKitFor(env, auth, caps, projectId);
  const title = requireText(input.title, "清单标题", 60);
  const remark = optionalText(input.remark, "备注", 200);
  const templateId = optionalId(input.template_id, "模板");
  const copyFromKitId = optionalId(input.copy_from_kit_id, "要复制的清单");
  if (templateId !== null && copyFromKitId !== null) throw badRequest("模板和复制只能选一个");
  const lines =
    templateId !== null
      ? await linesFromTemplate(env, templateId)
      : copyFromKitId !== null
        ? await linesFromKit(env, copyFromKitId)
        : parseKitLines(input.lines, "kit");
  if (templateId === null && copyFromKitId === null) {
    await assertCategoriesExist(env, lines);
    await assertMaterialsActive(env, lines);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [kitNo] = await generateSerials(env.DB, "PT", "project_kit", "kit_no", 1);
    const now = nowIso();
    try {
      await runAtomicBatch(env.DB, [
        env.DB.prepare(
          `INSERT INTO project_kit (kit_no, project_id, title, template_id, copied_from_kit_id, status, remark,
             created_by_userid, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?)`
        ).bind(kitNo, projectId, title, templateId, copyFromKitId, remark, auth.sub, now, now),
        ...lines.map((line) =>
          insertKitLine(env.DB, "(SELECT id FROM project_kit WHERE kit_no = ?)", kitNo, line, now)
        )
      ]);
      const row = await env.DB.prepare("SELECT id FROM project_kit WHERE kit_no = ?")
        .bind(kitNo)
        .first<{ id: number }>();
      return { id: Number(row?.id), kit_no: kitNo };
    } catch (error) {
      if (!isKitNoTaken(error) || attempt === 1) throw error;
    }
  }
  throw new WarehouseError(409, "清单号冲突，请重试");
};

const EDITABLE: readonly ProjectKitStatus[] = ["draft", "submitted"];

const assertEditable = (kit: ProjectKit): void => {
  if (kit.status === "confirmed")
    throw new WarehouseError(409, "清单已确认，不能再改；要追加请新建一份清单");
  if (kit.status === "closed") throw new WarehouseError(409, "清单已关闭");
};

export const updateProjectKit = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<void> => {
  const kit = await loadKit(env, id);
  assertEditable(kit);
  await assertCanEditKitFor(env, auth, caps, kit.project_id);
  const version = checkVersion(kit, input);
  const title = "title" in input ? requireText(input.title, "清单标题", 60) : kit.title;
  const remark = "remark" in input ? optionalText(input.remark, "备注", 200) : kit.remark;
  const lines = "lines" in input ? parseKitLines(input.lines, "kit") : null;
  if (lines) {
    await assertCategoriesExist(env, lines);
    await assertMaterialsActive(env, lines);
  }
  const now = nowIso();
  await runKitBatch(env, [
    guardKit(env.DB, id, version, EDITABLE),
    env.DB.prepare(
      "UPDATE project_kit SET title = ?, remark = ?, version = version + 1, updated_at = ? WHERE id = ?"
    ).bind(title, remark, now, id),
    ...(lines
      ? [
          env.DB.prepare("DELETE FROM project_kit_line WHERE kit_id = ?").bind(id),
          ...lines.map((line) => insertKitLine(env.DB, "?", id, line, now))
        ]
      : [])
  ]);
};

export const submitProjectKit = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<{ status: "submitted" | "confirmed" }> => {
  const kit = await loadKit(env, id);
  if (kit.status === "submitted") throw new WarehouseError(409, "清单已经提交过了");
  assertEditable(kit);
  await assertCanEditKitFor(env, auth, caps, kit.project_id);
  const version = checkVersion(kit, input);
  await assertKitReady(env, await loadStoredLines(env, id));
  // 库管自己建的清单直接确认（设计稿 7.1）
  const status = caps.is_keeper ? "confirmed" : "submitted";
  const now = nowIso();
  await runKitBatch(env, [
    guardKit(env.DB, id, version, ["draft"]),
    env.DB.prepare(
      `UPDATE project_kit SET status = ?, submitted_by_userid = ?, submitted_at = ?,
         confirmed_by_userid = ?, confirmed_at = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(
      status,
      auth.sub,
      now,
      status === "confirmed" ? auth.sub : null,
      status === "confirmed" ? now : null,
      now,
      id
    )
  ]);
  return { status };
};

export const confirmProjectKit = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  userid: string
): Promise<void> => {
  const kit = await loadKit(env, id);
  if (kit.status === "draft") throw new WarehouseError(409, "清单还没提交");
  if (kit.status === "confirmed") throw new WarehouseError(409, "清单已经确认过了");
  if (kit.status === "closed") throw new WarehouseError(409, "清单已关闭");
  const version = checkVersion(kit, input);
  await assertKitReady(env, await loadStoredLines(env, id));
  const now = nowIso();
  await runKitBatch(env, [
    guardKit(env.DB, id, version, ["submitted"]),
    env.DB.prepare(
      `UPDATE project_kit SET status = 'confirmed', confirmed_by_userid = ?, confirmed_at = ?,
         version = version + 1, updated_at = ? WHERE id = ?`
    ).bind(userid, now, now, id)
  ]);
};

/** 作废还没确认的清单（状态记为已关闭）。已确认的清单要结清后关闭，见 closeProjectKit。 */
export const discardProjectKit = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  auth: AuthTokenPayload,
  caps: WarehouseCapabilities
): Promise<void> => {
  const kit = await loadKit(env, id);
  if (kit.status === "confirmed")
    throw new WarehouseError(409, "已确认的清单不能作废，结清后可以关闭");
  if (kit.status === "closed") throw new WarehouseError(409, "清单已关闭");
  await assertCanEditKitFor(env, auth, caps, kit.project_id);
  const version = checkVersion(kit, input);
  const reason = requireText(input.reason, "作废原因", 200);
  const now = nowIso();
  await runKitBatch(env, [
    guardKit(env.DB, id, version, EDITABLE),
    env.DB.prepare(
      `UPDATE project_kit SET status = 'closed', closed_by_userid = ?, closed_at = ?, close_reason = ?,
         version = version + 1, updated_at = ? WHERE id = ?`
    ).bind(auth.sub, now, reason, now, id)
  ]);
};
