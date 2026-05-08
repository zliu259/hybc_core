import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { apiKeyMiddleware } from "../middleware/api-key";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import type {
  TaskResultSubmission,
  HeartbeatRequest,
  NodeRegistrationRequest,
  TaskQueueItem,
  ComputeNode
} from "../types/ai";
import { pollForNode, submitResult, registerNode, heartbeat } from "../services/task-queue";

export const taskRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

taskRoutes.get("/poll", apiKeyMiddleware, async (c) => {
  const nodeId = c.req.query("node_id");
  const capabilitiesRaw = c.req.query("capabilities");

  if (!nodeId) {
    return c.json({ success: false, error: { message: "Missing node_id parameter" } }, 400);
  }

  const capabilities = capabilitiesRaw
    ? capabilitiesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const result = await pollForNode(c.env, nodeId, capabilities);
  return c.json({ success: true, data: result });
});

taskRoutes.post("/nodes/register", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json()) as NodeRegistrationRequest;

  try {
    const node = await registerNode(c.env, body);
    return c.json({ success: true, data: node }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

taskRoutes.post("/nodes/:nodeId/heartbeat", apiKeyMiddleware, async (c) => {
  const nodeId = c.req.param("nodeId");
  const body = (await c.req.json()) as HeartbeatRequest;

  try {
    await heartbeat(c.env, nodeId, body);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Heartbeat failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

taskRoutes.post("/:id/result", apiKeyMiddleware, async (c) => {
  const taskId = Number(c.req.param("id"));
  const nodeId = c.req.header("x-node-id");
  const body = (await c.req.json()) as TaskResultSubmission;

  if (!nodeId) {
    return c.json({ success: false, error: { message: "Missing X-Node-Id header" } }, 400);
  }

  try {
    await submitResult(c.env, taskId, nodeId, body);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Submit failed";
    return c.json({ success: false, error: { message } }, 400);
  }
});

taskRoutes.get("/nodes", authMiddleware, requireRoles(["super_admin", "manager"]), async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM compute_node ORDER BY last_heartbeat_at DESC"
  ).all<ComputeNode>();

  return c.json({ success: true, data: rows.results ?? [] });
});

taskRoutes.get(
  "/queue",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const status = c.req.query("status");
    const taskType = c.req.query("task_type");
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    let sql = "SELECT * FROM task_queue WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM task_queue WHERE 1=1";
    const params: string[] = [];

    if (status) {
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(status);
    }
    if (taskType) {
      sql += " AND task_type = ?";
      countSql += " AND task_type = ?";
      params.push(taskType);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

    const countResult = await c.env.DB.prepare(countSql)
      .bind(...params)
      .first<{ total: number }>();

    const rows = await c.env.DB.prepare(sql)
      .bind(...params, pageSize, offset)
      .all<TaskQueueItem>();

    return c.json({
      success: true,
      data: rows.results ?? [],
      pagination: {
        page,
        pageSize,
        total: countResult?.total ?? 0
      }
    });
  }
);

taskRoutes.get(
  "/:id",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const id = Number(c.req.param("id"));

    const task = await c.env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
      .bind(id)
      .first<TaskQueueItem>();

    if (!task) {
      return c.json({ success: false, error: { message: "Task not found" } }, 404);
    }

    return c.json({ success: true, data: task });
  }
);
