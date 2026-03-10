import { Hono } from "hono";

import { apiKeyMiddleware } from "../middleware/api-key";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { checkApprovalTimeouts } from "../services/approval/engine";
import { checkTimeouts } from "../services/ai-slot";
import { createTask } from "../services/ai-slot";
import { checkNodeHeartbeat, detectMissingLogs, requeueTimedOutTasks } from "../services/cron-jobs";
import { getWeComContactBook } from "../services/wecom-contact-book";

export const systemRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const textEncoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const buildBridgeSignature = async (
  secret: string,
  timestamp: string,
  nonce: string,
  body: string
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const payload = `${timestamp}.${nonce}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
};

const isBridgeTimestampFresh = (timestamp: string, windowSeconds = 300): boolean => {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - value) <= windowSeconds;
};

type HealthItem = {
  key: string;
  status: "up" | "down";
  checked_at: string;
  detail?: string;
  latency_ms?: number;
  overloaded?: boolean;
};

const parseCsvUrls = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
};

const checkExternalHealth = async (key: string, url: string): Promise<HealthItem> => {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    return {
      key,
      status: resp.status >= 200 && resp.status < 400 ? "up" : "down",
      checked_at: new Date().toISOString(),
      detail: `http ${resp.status}`,
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      key,
      status: "down",
      checked_at: new Date().toISOString(),
      detail: error instanceof Error ? error.message : "network error",
      latency_ms: Date.now() - started,
    };
  }
};

const checkRelayStatus = async (key: string, url: string): Promise<HealthItem> => {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(timer);
    if (!(resp.status >= 200 && resp.status < 400)) {
      return {
        key,
        status: "down",
        checked_at: new Date().toISOString(),
        detail: `http ${resp.status}`,
        latency_ms: Date.now() - started,
      };
    }

    let overloaded = false;
    let reason = "ok";
    try {
      const body = (await resp.json()) as { overloaded?: boolean; reason?: string };
      overloaded = body.overloaded === true;
      reason = body.reason || (overloaded ? "overloaded" : "ok");
    } catch {
      reason = "status_parse_failed";
    }

    return {
      key,
      status: overloaded ? "down" : "up",
      checked_at: new Date().toISOString(),
      detail: overloaded ? `overloaded:${reason}` : reason,
      latency_ms: Date.now() - started,
      overloaded,
    };
  } catch (error) {
    return {
      key,
      status: "down",
      checked_at: new Date().toISOString(),
      detail: error instanceof Error ? error.message : "network error",
      latency_ms: Date.now() - started,
      overloaded: false,
    };
  }
};

systemRoutes.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "api",
    env: c.env.APP_ENV,
    now: new Date().toISOString()
  });
});

systemRoutes.use("/ops/*", authMiddleware, requireRoles(["super_admin", "manager"]));

systemRoutes.get("/ops/status-center", async (c) => {
  const now = new Date().toISOString();
  const items: HealthItem[] = [];

  const d1Started = Date.now();
  try {
    await c.env.DB.prepare("SELECT 1 as ok").first();
    items.push({
      key: "worker_d1",
      status: "up",
      checked_at: now,
      detail: "query ok",
      latency_ms: Date.now() - d1Started,
    });
  } catch (error) {
    items.push({
      key: "worker_d1",
      status: "down",
      checked_at: now,
      detail: error instanceof Error ? error.message : "query failed",
      latency_ms: Date.now() - d1Started,
    });
  }

  const kvStarted = Date.now();
  try {
    const markerKey = `health:ops:${Date.now()}`;
    await c.env.KV.put(markerKey, "1", { expirationTtl: 60 });
    const value = await c.env.KV.get(markerKey);
    items.push({
      key: "worker_kv",
      status: value === "1" ? "up" : "down",
      checked_at: now,
      detail: value === "1" ? "read/write ok" : "read mismatch",
      latency_ms: Date.now() - kvStarted,
    });
  } catch (error) {
    items.push({
      key: "worker_kv",
      status: "down",
      checked_at: now,
      detail: error instanceof Error ? error.message : "kv failed",
      latency_ms: Date.now() - kvStarted,
    });
  }

  const r2Started = Date.now();
  try {
    const r2Key = `health/ops-${Date.now()}.txt`;
    await c.env.FILES.put(r2Key, "ok", { httpMetadata: { contentType: "text/plain" } });
    const object = await c.env.FILES.get(r2Key);
    const text = object ? await object.text() : "";
    items.push({
      key: "worker_r2",
      status: text === "ok" ? "up" : "down",
      checked_at: now,
      detail: text === "ok" ? "read/write ok" : "read mismatch",
      latency_ms: Date.now() - r2Started,
    });
  } catch (error) {
    items.push({
      key: "worker_r2",
      status: "down",
      checked_at: now,
      detail: error instanceof Error ? error.message : "r2 failed",
      latency_ms: Date.now() - r2Started,
    });
  }

  const queueStarted = Date.now();
  try {
    await c.env.EVENT_QUEUE.send({
      type: "system.ops.health_ping",
      at: now,
    });
    items.push({
      key: "worker_queue",
      status: "up",
      checked_at: now,
      detail: "enqueue ok",
      latency_ms: Date.now() - queueStarted,
    });
  } catch (error) {
    items.push({
      key: "worker_queue",
      status: "down",
      checked_at: now,
      detail: error instanceof Error ? error.message : "enqueue failed",
      latency_ms: Date.now() - queueStarted,
    });
  }

  const bridgeUrl = c.env.BRIDGE_HEALTH_URL || "https://bridge.hybcdg.com/health";
  const runnerUrl = c.env.RUNNER_HEALTH_URL || "https://runner.hybcdg.com/health";
  const relayStatusUrls = parseCsvUrls(c.env.RELAY_STATUS_URLS);
  const relayChecks = relayStatusUrls.map((url, index) => {
    const key = `relay_${index + 1}`;
    return checkRelayStatus(key, url);
  });

  const externalChecks = await Promise.all([
    checkExternalHealth("bridge_service", bridgeUrl),
    checkExternalHealth("runner_service", runnerUrl),
    ...relayChecks,
  ]);
  items.push(...externalChecks);

  const nodeRows = await c.env.DB.prepare(
    `SELECT node_id, node_name, status, last_heartbeat_at
     FROM compute_node
     ORDER BY last_heartbeat_at DESC
     LIMIT 20`
  ).all<{
    node_id: string;
    node_name: string;
    status: string;
    last_heartbeat_at: string | null;
  }>();

  const onlineCount = (nodeRows.results ?? []).filter((row) => {
    if (row.status !== "online" || !row.last_heartbeat_at) {
      return false;
    }
    return Date.now() - new Date(row.last_heartbeat_at).getTime() <= 10 * 60 * 1000;
  }).length;

  return c.json({
    success: true,
    data: {
      checked_at: now,
      services: items,
      runner_nodes: {
        online_recent_count: onlineCount,
        sampled_total: (nodeRows.results ?? []).length,
        latest: nodeRows.results ?? [],
      },
    },
  });
});

systemRoutes.get("/ops/wecom-bridge-config", async (c) => {
  const relayStatusUrls = parseCsvUrls(c.env.RELAY_STATUS_URLS);
  return c.json({
    success: true,
    data: {
      wechat_bridge_base_url: c.env.WECHAT_BRIDGE_BASE_URL || "",
      has_bridge_token: Boolean(c.env.WECHAT_BRIDGE_TOKEN),
      relay_status_urls: relayStatusUrls,
    },
  });
});

systemRoutes.get("/storage-check", async (c) => {
  const marker = `ping-${Date.now()}`;
  const key = `health/${marker}.txt`;

  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind("system_check", "api", JSON.stringify({ marker }), new Date().toISOString())
    .run();

  await c.env.FILES.put(key, marker, {
    httpMetadata: { contentType: "text/plain" }
  });

  await c.env.KV.put(`health:${marker}`, marker);

  const file = await c.env.FILES.get(key);
  const value = file ? await file.text() : null;
  const kvValue = await c.env.KV.get(`health:${marker}`);

  await c.env.EVENT_QUEUE.send({
    type: "system.storage_check",
    marker,
    at: new Date().toISOString()
  });

  return c.json({
    ok: true,
    d1Inserted: marker,
    r2Key: key,
    r2Value: value,
    kvValue
  });
});

systemRoutes.get("/automation/approval-notification", apiKeyMiddleware, async (c) => {
  const now = new Date().toISOString();
  const rows = await c.env.DB.prepare(
    `SELECT ai.id as instance_id, ai.instance_no, ai.biz_type, ai.biz_summary,
            at2.assignee_userid, at2.created_at as task_created_at
     FROM approval_task at2
     JOIN approval_instance ai ON ai.id = at2.instance_id
     WHERE at2.status = 'pending'
       AND (julianday(?) - julianday(at2.created_at)) * 24 >= 1
     ORDER BY at2.created_at ASC
     LIMIT 200`
  )
    .bind(now)
    .all();

  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/risk-alert", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, task_code, task_type, biz_type, biz_id, status, error_message, updated_at
     FROM task_queue
     WHERE status IN ('failed', 'timeout')
       AND task_type IN ('payment_risk_assessment', 'reimbursement_anomaly', 'inventory_alert_analysis', 'consumption_anomaly')
     ORDER BY updated_at DESC
     LIMIT 200`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/task-queue-backlog", apiKeyMiddleware, async (c) => {
  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM task_queue WHERE status = 'pending'`
  ).first<{ total: number }>();

  const assigned = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM task_queue WHERE status = 'assigned'`
  ).first<{ total: number }>();

  const oldestPending = await c.env.DB.prepare(
    `SELECT task_code, created_at
     FROM task_queue
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`
  ).first<{ task_code: string; created_at: string }>();

  return c.json({
    success: true,
    data: {
      pending: pending?.total ?? 0,
      assigned: assigned?.total ?? 0,
      should_wake_runner: (pending?.total ?? 0) > 0 || (assigned?.total ?? 0) > 0,
      oldest_pending: oldestPending ?? null,
      checked_at: new Date().toISOString()
    }
  });
});

systemRoutes.get("/automation/monthly-financial-report", apiKeyMiddleware, async (c) => {
  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const endExpr = `${month}-31`;

  const outbound = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(amount), 0) as total
     FROM payment_request
     WHERE status = 'paid'
       AND DATE(COALESCE(paid_at, updated_at)) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  const inbound = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(amount), 0) as total
     FROM receipt
     WHERE status != 'deleted'
       AND DATE(received_date) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  const reimburse = await c.env.DB.prepare(
    `SELECT IFNULL(SUM(total_amount), 0) as total
     FROM reimbursement_batch
     WHERE status = 'paid'
       AND DATE(updated_at) BETWEEN DATE(?) AND DATE(?)`
  )
    .bind(start, endExpr)
    .first<{ total: number }>();

  return c.json({
    success: true,
    data: {
      month,
      outbound_paid_amount: outbound?.total ?? 0,
      inbound_received_amount: inbound?.total ?? 0,
      reimbursement_paid_amount: reimburse?.total ?? 0
    }
  });
});

systemRoutes.get("/automation/contract-expiry-reminder", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, contract_no, counterparty, contract_date, direction, status
     FROM contract
     WHERE status = 'active'
       AND DATE(contract_date) <= DATE('now', '-335 day')
       AND DATE(contract_date) >= DATE('now', '-395 day')
     ORDER BY contract_date ASC
     LIMIT 200`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.get("/automation/log-missing-alert", apiKeyMiddleware, async (c) => {
  const date = c.req.query("date") ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT p.id as project_id, p.project_name
     FROM project p
     WHERE p.status IN ('preparing', 'active', 'completing')
       AND NOT EXISTS (
         SELECT 1 FROM operator_log ol
         WHERE ol.project_id = p.id
           AND ol.status != 'deleted'
           AND ol.log_date = ?
       )
     ORDER BY p.id DESC`
  )
    .bind(date)
    .all();
  return c.json({ success: true, data: { date, projects: rows.results ?? [] } });
});

systemRoutes.get("/automation/contact-sync", apiKeyMiddleware, async (c) => {
  const now = new Date().toISOString();
  await c.env.KV.put("wecom:contacts:last_sync_at", now);
  return c.json({ success: true, data: { synced_at: now, mode: "placeholder" } });
});

systemRoutes.post("/automation/payee-internal-bind", apiKeyMiddleware, async (c) => {
  const contactBook = await getWeComContactBook(c.env, { forceRefresh: true });

  const useridsByName = new Map<string, string[]>();
  for (const user of contactBook.users) {
    const name = `${user.name || ""}`.trim();
    const userid = `${user.userid || ""}`.trim();
    if (!name || !userid) continue;
    const list = useridsByName.get(name) ?? [];
    if (!list.includes(userid)) list.push(userid);
    useridsByName.set(name, list);
  }

  const payees = await c.env.DB.prepare(
    "SELECT id, name, created_by_userid FROM payee WHERE type = 'internal' AND status = 'active' ORDER BY id ASC"
  ).all<{ id: number; name: string; created_by_userid: string }>();

  const now = new Date().toISOString();
  let matched = 0;
  let updated = 0;
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  for (const row of payees.results ?? []) {
    const name = `${row.name || ""}`.trim();
    if (!name) continue;
    const candidates = useridsByName.get(name) ?? [];
    if (candidates.length === 0) {
      unmatched.push(name);
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push(name);
      continue;
    }

    matched += 1;
    const targetUserid = candidates[0];
    if (row.created_by_userid !== targetUserid) {
      await c.env.DB.prepare("UPDATE payee SET created_by_userid = ?, updated_at = ? WHERE id = ?")
        .bind(targetUserid, now, row.id)
        .run();
      updated += 1;
    }
  }

  return c.json({
    success: true,
    data: {
      wecom_users: contactBook.users.length,
      internal_payees: (payees.results ?? []).length,
      matched,
      updated,
      unmatched_count: unmatched.length,
      ambiguous_count: ambiguous.length,
      unmatched_names: [...new Set(unmatched)].slice(0, 20),
      ambiguous_names: [...new Set(ambiguous)].slice(0, 20)
    }
  });
});

systemRoutes.post("/automation/project-init", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { project_id?: number; project_name?: string };
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      "project_init",
      "runner_automation",
      JSON.stringify({ project_id: body.project_id ?? null, project_name: body.project_name ?? null, created_at: now }),
      now
    )
    .run();
  return c.json({ success: true, data: { handled_at: now } }, 201);
});

systemRoutes.post("/automation/daily-log-summary", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project_id?: number;
    date_from?: string;
    date_to?: string;
  };
  const task = await createTask(c.env, {
    task_type: "log_summary",
    biz_type: "construction_log",
    biz_id: body.project_id ?? 0,
    payload: {
      report_type: "daily",
      project_id: body.project_id ?? null,
      date_from: body.date_from ?? null,
      date_to: body.date_to ?? null
    },
    priority: 5
  });
  return c.json({ success: true, data: { task_id: task.id } }, 201);
});

systemRoutes.post("/automation/weekly-log-summary", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project_id?: number;
    date_from?: string;
    date_to?: string;
  };
  const task = await createTask(c.env, {
    task_type: "log_summary",
    biz_type: "construction_log",
    biz_id: body.project_id ?? 0,
    payload: {
      report_type: "weekly",
      project_id: body.project_id ?? null,
      date_from: body.date_from ?? null,
      date_to: body.date_to ?? null
    },
    priority: 5
  });
  return c.json({ success: true, data: { task_id: task.id } }, 201);
});

systemRoutes.get("/automation/inventory-alert-notify", apiKeyMiddleware, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.warehouse_id, i.asset_type_id, i.quantity,
            w.warehouse_name, at.type_name,
            COALESCE(i.min_stock, at.min_stock, 0) as threshold
     FROM inventory i
     JOIN warehouse w ON w.id = i.warehouse_id
     JOIN asset_type at ON at.id = i.asset_type_id
     WHERE i.status = 'active' AND i.quantity < COALESCE(i.min_stock, at.min_stock, 0)
     ORDER BY i.quantity ASC`
  ).all();
  return c.json({ success: true, data: rows.results ?? [] });
});

systemRoutes.post("/automation/cron/run", apiKeyMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { job?: string };
  const job = body.job ?? "all";

  const result: Record<string, number> = {};
  if (job === "all" || job === "heartbeat_check") {
    result.heartbeat_check = await checkNodeHeartbeat(c.env);
  }
  if (job === "all" || job === "approval_timeout") {
    result.approval_timeout = await checkApprovalTimeouts(c.env);
  }
  if (job === "all" || job === "task_timeout") {
    result.task_timeout = await checkTimeouts(c.env);
  }
  if (job === "all" || job === "task_requeue") {
    result.task_requeue = await requeueTimedOutTasks(c.env);
  }
  if (job === "all" || job === "log_missing") {
    result.log_missing = await detectMissingLogs(c.env);
  }

  return c.json({ success: true, data: result });
});

systemRoutes.post("/bridge/wecom-ingest", async (c) => {
  const source = c.req.header("x-bridge-source") ?? "unknown";
  const timestamp = c.req.header("x-bridge-timestamp") ?? "";
  const nonce = c.req.header("x-bridge-nonce") ?? "";
  const signature = c.req.header("x-bridge-signature") ?? "";

  if (!timestamp || !nonce || !signature) {
    return c.json({ success: false, error: { message: "missing bridge signature headers" } }, 401);
  }

  if (!isBridgeTimestampFresh(timestamp)) {
    return c.json({ success: false, error: { message: "stale bridge timestamp" } }, 401);
  }

  const nonceKey = `bridge:nonce:${nonce}`;
  const exists = await c.env.KV.get(nonceKey);
  if (exists) {
    return c.json({ success: false, error: { message: "replayed bridge nonce" } }, 409);
  }

  const rawBody = await c.req.text();
  const sharedSecret = c.env.BRIDGE_HMAC_SECRET || c.env.TASK_API_KEY;
  const expected = await buildBridgeSignature(sharedSecret, timestamp, nonce, rawBody);
  if (expected !== signature) {
    return c.json({ success: false, error: { message: "invalid bridge signature" } }, 401);
  }

  await c.env.KV.put(nonceKey, "1", { expirationTtl: 600 });

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody };
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind("wecom_bridge_ingest", source, JSON.stringify(payload), now)
    .run();

  return c.json({ success: true, data: { accepted_at: now } }, 201);
});

systemRoutes.get("/automation/legacy-finance-compat", apiKeyMiddleware, async (c) => {
  const tableCounts = {
    entity: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM entity"
    ).first<{ total: number; legacy_total: number }>(),
    payee: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM payee"
    ).first<{ total: number; legacy_total: number }>(),
    contract: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM contract WHERE status != 'deleted'"
    ).first<{ total: number; legacy_total: number }>(),
    payment_request: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM payment_request WHERE status != 'cancelled'"
    ).first<{ total: number; legacy_total: number }>(),
    reimbursement_envelope: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM reimbursement_envelope WHERE status != 'deleted'"
    ).first<{ total: number; legacy_total: number }>(),
    reimbursement_batch: await c.env.DB.prepare(
      "SELECT COUNT(*) as total, COUNT(legacy_data_id) as legacy_total FROM reimbursement_batch"
    ).first<{ total: number; legacy_total: number }>()
  };

  const integrity = {
    payment_request_missing_payee: await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM payment_request pr
       WHERE pr.legacy_data_id IS NOT NULL
         AND pr.payee_id NOT IN (SELECT id FROM payee)`
    ).first<{ cnt: number }>(),
    payment_request_missing_contract: await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM payment_request pr
       WHERE pr.legacy_data_id IS NOT NULL
         AND pr.contract_id IS NOT NULL
         AND pr.contract_id NOT IN (SELECT id FROM contract)`
    ).first<{ cnt: number }>(),
    contract_missing_entity: await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM contract c
       WHERE c.legacy_data_id IS NOT NULL
         AND c.entity_id NOT IN (SELECT id FROM entity)`
    ).first<{ cnt: number }>(),
    contract_missing_project: await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM contract c
       WHERE c.legacy_data_id IS NOT NULL
         AND c.project_id NOT IN (SELECT id FROM project)`
    ).first<{ cnt: number }>(),
    reimbursement_envelope_missing_project: await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt
       FROM reimbursement_envelope re
       WHERE re.legacy_data_id IS NOT NULL
         AND re.project_id NOT IN (SELECT id FROM project)`
    ).first<{ cnt: number }>()
  };

  return c.json({
    success: true,
    data: {
      generated_at: new Date().toISOString(),
      table_counts: tableCounts,
      integrity
    }
  });
});
