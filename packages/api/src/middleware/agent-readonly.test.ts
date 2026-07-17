import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  AGENT_READONLY_MESSAGE,
  agentReadonlyForbidden,
  isAllowedAgentRead
} from "./agent-readonly";
import { authMiddleware, type AuthVariables } from "./auth";
import { createAgentGrant } from "../services/agent-grant";
import { createSessionPayload, issueTokens } from "../services/auth";
import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

// ---------------------------------------------------------------------------
// Unit tests: the deny-by-default allowlist itself.
// ---------------------------------------------------------------------------

// 13 个 @hybc/mcp 只读工具端点，写成【生产完整路径】形态；normalize 后应命中白名单。
const ALLOWED_FULL_PATHS = [
  "/api/v1/project",
  "/api/v1/project/123",
  "/api/v1/project/123/financial-summary",
  "/api/v1/payment",
  "/api/v1/payment/9",
  "/api/v1/contract",
  "/api/v1/contract/3",
  "/api/v1/approval",
  "/api/v1/approval/pending",
  "/api/v1/approval/4",
  "/api/v1/warehouse/inventory",
  "/api/v1/warehouse/inventory/alert",
  "/api/v1/warehouse/stock-order"
];

describe("isAllowedAgentRead — allowlist = exactly the @hybc/mcp read surface", () => {
  it("allows every one of the 13 read endpoints (full /api/v1 path form)", () => {
    for (const path of ALLOWED_FULL_PATHS) {
      expect(isAllowedAgentRead("GET", path)).toBe(true);
    }
  });

  it("allows the same endpoints in route-relative form (unit-test call style)", () => {
    for (const path of ALLOWED_FULL_PATHS) {
      expect(isAllowedAgentRead("GET", path.replace(/^\/api\/v1/, ""))).toBe(true);
    }
  });

  it("distinguishes /approval/pending from /approval/:id and rejects non-numeric ids", () => {
    expect(isAllowedAgentRead("GET", "/approval/pending")).toBe(true);
    expect(isAllowedAgentRead("GET", "/approval/123")).toBe(true);
    // 非数字、非 pending 的 approval 段不在白名单（:id 只接受数字，避免误伤 pending）
    expect(isAllowedAgentRead("GET", "/approval/foo")).toBe(false);
    expect(isAllowedAgentRead("GET", "/approval/pending/extra")).toBe(false);
  });

  it("BLOCKS mutating-GET endpoints that are not in the read allowlist", () => {
    // 这是本次重构的核心：以 GET 触发写的端点（poll-and-sync）必须被拒。
    expect(isAllowedAgentRead("GET", "/api/v1/reimbursement/42/ocr-status")).toBe(false);
    expect(isAllowedAgentRead("GET", "/reimbursement/42/ocr-status")).toBe(false);
    expect(isAllowedAgentRead("GET", "/api/v1/bidding/dedup/1/refresh")).toBe(false);
  });

  it("BLOCKS unlisted reads (human web surfaces the MCP client never calls)", () => {
    expect(isAllowedAgentRead("GET", "/api/v1/user/me")).toBe(false);
    expect(isAllowedAgentRead("GET", "/user/routes")).toBe(false);
    expect(isAllowedAgentRead("GET", "/agent/grants")).toBe(false);
    expect(isAllowedAgentRead("GET", "/api/v1/admin/agent/grants")).toBe(false);
  });

  it("BLOCKS all mutating methods, even on an allowlisted read path", () => {
    expect(isAllowedAgentRead("POST", "/api/v1/payment")).toBe(false);
    expect(isAllowedAgentRead("PUT", "/api/v1/project/1")).toBe(false);
    expect(isAllowedAgentRead("PATCH", "/api/v1/project/1")).toBe(false);
    expect(isAllowedAgentRead("DELETE", "/api/v1/payment/1")).toBe(false);
  });

  it("matches the method case-insensitively", () => {
    expect(isAllowedAgentRead("get", "/api/v1/project")).toBe(true);
    expect(isAllowedAgentRead("Get", "/project")).toBe(true);
    expect(isAllowedAgentRead("post", "/api/v1/payment")).toBe(false);
  });
});

describe("agentReadonlyForbidden", () => {
  it("returns a 403 JSON envelope carrying the read-only message", async () => {
    const res = agentReadonlyForbidden();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { success: boolean; error: { message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
    expect(AGENT_READONLY_MESSAGE).toBe("智能体令牌为只读，禁止写操作");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: the gate wired into authMiddleware. Routes are mounted at
// their real /api/v1 prefixes so the gate sees the SAME path form as production.
// ---------------------------------------------------------------------------

interface ForbiddenBody {
  success: boolean;
  error: { message: string };
}

// 捕获审计写入的 D1：INSERT INTO api_audit_log 记录到数组，其余委托给 agent_grant 假实现。
const buildAuditCapturingEnv = () => {
  const { db: raw } = createFakeD1();
  const { kv } = createFakeKV();
  const audits: Array<Record<string, unknown>> = [];
  const db = {
    prepare(sql: string) {
      if (sql.includes("INSERT INTO api_audit_log")) {
        const api = {
          bind(...args: unknown[]) {
            const [
              actor_userid,
              actor_roles_json,
              action,
              target_type,
              target_id,
              status,
              detail_json
            ] = args;
            audits.push({
              actor_userid,
              actor_roles_json,
              action,
              target_type,
              target_id,
              status,
              detail_json
            });
            return api;
          },
          async run() {
            return { success: true, meta: {} };
          }
        };
        return api;
      }
      return raw.prepare(sql);
    }
  } as unknown as D1Database;
  return { env: { DB: db, KV: kv, JWT_SECRET: "test-secret" } as unknown as Env, audits, raw };
};

const buildApp = () => {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.use("/api/v1/*", authMiddleware);
  // 白名单内的只读端点
  app.get("/api/v1/project", (c) => c.json({ ok: true, kind: "allowed-read" }));
  // 不在白名单的「以 GET 触发写」端点（poll-and-sync 模式）
  app.get("/api/v1/reimbursement/:id/ocr-status", (c) =>
    c.json({ ok: true, kind: "mutating-get" })
  );
  // 不在白名单的普通读（人类网页面向）
  app.get("/api/v1/user/me", (c) => c.json({ ok: true, kind: "unlisted-read" }));
  // 写方法
  app.post("/api/v1/payment", (c) => c.json({ ok: true, kind: "write" }));
  app.put("/api/v1/project/:id", (c) => c.json({ ok: true, kind: "write" }));
  app.delete("/api/v1/payment/:id", (c) => c.json({ ok: true, kind: "write" }));
  return app;
};

const mintAgentToken = async (
  raw: D1Database,
  role: UserRole = "finance"
): Promise<string> => {
  const { token } = await createAgentGrant(raw, { wecomUserid: "MaxLiu", role });
  return token;
};

const mintHumanJwt = async (env: Env, role: UserRole = "finance"): Promise<string> => {
  const session = createSessionPayload({ userId: "MaxLiu", username: "MaxLiu", role });
  const issued = await issueTokens(env, session);
  return issued.accessToken;
};

describe("authMiddleware deny-by-default gate for mcp_agent tokens", () => {
  it("lets an agent token reach an allowlisted read (GET /api/v1/project → 200)", async () => {
    const { env, raw } = buildAuditCapturingEnv();
    const token = await mintAgentToken(raw);
    const res = await buildApp().request(
      "/api/v1/project",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; kind: string };
    expect(body.kind).toBe("allowed-read");
  });

  it("BLOCKS an agent token on a mutating-GET not in the allowlist (403 read-only)", async () => {
    // 核心断言：方法闸门会放行这个 GET；白名单闸门必须拦下它。
    const { env, raw } = buildAuditCapturingEnv();
    const token = await mintAgentToken(raw);
    const res = await buildApp().request(
      "/api/v1/reimbursement/42/ocr-status",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ForbiddenBody;
    expect(body.success).toBe(false);
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("BLOCKS an agent token on an unlisted read (GET /api/v1/user/me → 403)", async () => {
    const { env, raw } = buildAuditCapturingEnv();
    const token = await mintAgentToken(raw);
    const res = await buildApp().request(
      "/api/v1/user/me",
      { headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ForbiddenBody;
    expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
  });

  it("BLOCKS agent-token writes (POST/PUT/DELETE → 403 read-only)", async () => {
    const { env, raw } = buildAuditCapturingEnv();
    const token = await mintAgentToken(raw);
    const app = buildApp();
    for (const req of [
      { path: "/api/v1/payment", method: "POST" },
      { path: "/api/v1/project/1", method: "PUT" },
      { path: "/api/v1/payment/1", method: "DELETE" }
    ]) {
      const res = await app.request(
        req.path,
        { method: req.method, headers: { authorization: `Bearer ${token}` } },
        env
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as ForbiddenBody;
      expect(body.error.message).toBe(AGENT_READONLY_MESSAGE);
    }
  });

  it("does NOT block a human JWT on the same mutating-GET or write", async () => {
    const { env } = buildAuditCapturingEnv();
    const jwt = await mintHumanJwt(env);
    const app = buildApp();

    const mutatingGet = await app.request(
      "/api/v1/reimbursement/42/ocr-status",
      { headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(mutatingGet.status).toBe(200);

    const write = await app.request(
      "/api/v1/payment",
      { method: "POST", headers: { authorization: `Bearer ${jwt}` } },
      env
    );
    expect(write.status).toBe(200);
  });

  it("audits a blocked agent write attempt (action=agent.blocked_write, status=blocked)", async () => {
    const { env, raw, audits } = buildAuditCapturingEnv();
    const token = await mintAgentToken(raw);
    const res = await buildApp().request(
      "/api/v1/payment",
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      env
    );
    expect(res.status).toBe(403);
    const blocked = audits.find((a) => a.action === "agent.blocked_write");
    expect(blocked).toBeDefined();
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.actor_userid).toBe("MaxLiu");
    expect(String(blocked?.target_id)).toContain("/payment");
  });
});
