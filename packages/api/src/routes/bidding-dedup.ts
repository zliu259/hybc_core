import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { enqueueTask } from "../services/task-queue";

export interface RewriteParagraph {
  id: string;
  text: string;
}

const MAX_PARAGRAPHS = 200;
const MAX_TEXT = 5000;
// 投标查重为业务/投标部门工具，权限与前端「投标」菜单一致（不含 finance）。
const ROLES = ["super_admin", "manager", "site_manager", "operator"] as const;

type ParseOk = { ok: true; paragraphs: RewriteParagraph[] };
type ParseErr = { ok: false; error: string };

export function parseRewriteRequest(body: unknown): ParseOk | ParseErr {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = obj.paragraphs;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "paragraphs 不能为空" };
  }
  if (raw.length > MAX_PARAGRAPHS) {
    return { ok: false, error: `段落数量超过上限 ${MAX_PARAGRAPHS}` };
  }
  const paragraphs: RewriteParagraph[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "段落格式错误" };
    const id = (item as Record<string, unknown>).id;
    const text = (item as Record<string, unknown>).text;
    if (typeof id !== "string" || id.length === 0) return { ok: false, error: "段落缺少 id" };
    if (typeof text !== "string" || text.length === 0) return { ok: false, error: "段落缺少 text" };
    if (text.length > MAX_TEXT) return { ok: false, error: `单段文本超过 ${MAX_TEXT} 字符` };
    paragraphs.push({ id, text });
  }
  return { ok: true, paragraphs };
}

export interface RewriteResultResponse {
  status: string;
  rewrites?: RewriteParagraph[];
  error?: string;
}

export function parseRewriteResult(task: {
  status: string;
  result_json: string | null;
  error_message?: string | null;
}): RewriteResultResponse {
  if (task.status === "failed" || task.status === "timeout") {
    return { status: task.status, error: task.error_message ?? "任务失败" };
  }
  if (task.status !== "completed") {
    return { status: task.status };
  }
  if (!task.result_json) {
    return { status: "completed", rewrites: [] };
  }
  try {
    const outer = JSON.parse(task.result_json) as { output?: string };
    if (!outer.output) return { status: "completed", rewrites: [] };
    const inner = JSON.parse(outer.output) as { rewrites?: unknown };
    const list = Array.isArray(inner.rewrites) ? inner.rewrites : [];
    const rewrites: RewriteParagraph[] = list
      .filter(
        (r): r is RewriteParagraph =>
          !!r &&
          typeof r === "object" &&
          typeof (r as RewriteParagraph).id === "string" &&
          typeof (r as RewriteParagraph).text === "string"
      )
      .map((r) => ({ id: r.id, text: r.text }));
    return { status: "completed", rewrites };
  } catch {
    return { status: "completed", rewrites: [] };
  }
}

export const biddingDedupRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

biddingDedupRoutes.post(
  "/dedup-rewrite",
  authMiddleware,
  requireRoles([...ROLES]),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = parseRewriteRequest(body);
    if (!parsed.ok) {
      return c.json({ success: false, error: { message: parsed.error } }, 400);
    }
    const task = await enqueueTask(c.env, {
      task_type: "bidding_dedup_rewrite",
      biz_type: "bidding_dedup",
      biz_id: 0,
      payload: { paragraphs: parsed.paragraphs },
      priority: 6
    });
    return c.json({ success: true, data: { task_id: task.id } });
  }
);

biddingDedupRoutes.get(
  "/dedup-rewrite/:taskId",
  authMiddleware,
  requireRoles([...ROLES]),
  async (c) => {
    const taskId = Number(c.req.param("taskId"));
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return c.json({ success: false, error: { message: "无效任务 id" } }, 400);
    }
    const task = await c.env.DB.prepare(
      "SELECT id, biz_type, status, result_json, error_message FROM task_queue WHERE id = ?"
    )
      .bind(taskId)
      .first<{
        id: number;
        biz_type: string;
        status: string;
        result_json: string | null;
        error_message: string | null;
      }>();
    if (!task || task.biz_type !== "bidding_dedup") {
      return c.json({ success: false, error: { message: "任务不存在" } }, 404);
    }
    const response = parseRewriteResult(task);
    // On terminal status: purge sensitive payload/result text, keep metadata for audit.
    // payload_json is TEXT NOT NULL; use a valid-JSON sentinel '{}' for both columns.
    // A purge failure must NOT steal the already-computed response from the client.
    if (
      task.status === "completed" ||
      task.status === "failed" ||
      task.status === "timeout"
    ) {
      try {
        await c.env.DB.prepare(
          "UPDATE task_queue SET payload_json = '{}', result_json = '{}' WHERE id = ?"
        )
          .bind(taskId)
          .run();
      } catch (err) {
        // 清除失败不影响已取回的结果；记录后继续返回。
        console.error("dedup-rewrite purge failed", taskId, err);
      }
    }
    return c.json({ success: true, data: response });
  }
);
