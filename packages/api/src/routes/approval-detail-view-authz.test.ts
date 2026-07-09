import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload, UserRole } from "../types/auth";
import type { Env } from "../types/env";
import { approvalRoutes } from "./approval";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "someone",
    username: "someone",
    nickname: "Someone",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

// ── Mutable DB fixture ──────────────────────────────────────────
// One approval instance (id 42) initiated by "alice", with a pending
// approver task for "bob" and a completed cc task for "carol".
type DbState = {
  instance: Record<string, unknown> | null;
  tasks: Record<string, unknown>[];
};

const defaultInstance = (): Record<string, unknown> => ({
  id: 42,
  instance_no: "AP-20260709-001",
  template_id: 7,
  biz_type: "payment_request",
  biz_id: 100,
  biz_summary: "机密付款 100000 元",
  initiator_userid: "alice",
  biz_applicant_userid: null,
  current_node_key: "n1",
  status: "in_progress",
  current_round: 1,
  instance_config_json: null,
  submitted_at: "2026-07-09T00:00:00.000Z",
  completed_at: null,
  created_at: "2026-07-09T00:00:00.000Z",
  updated_at: "2026-07-09T00:00:00.000Z"
});

const defaultTasks = (): Record<string, unknown>[] => [
  {
    id: 1,
    node_instance_id: 10,
    instance_id: 42,
    assignee_userid: "bob",
    action: null,
    comment: null,
    round: 1,
    status: "pending",
    acted_at: null,
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z"
  },
  {
    id: 2,
    node_instance_id: 11,
    instance_id: 42,
    assignee_userid: "carol",
    action: null,
    comment: null,
    round: 1,
    status: "completed",
    acted_at: null,
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z"
  }
];

const dbState: DbState = {
  instance: defaultInstance(),
  tasks: defaultTasks()
};

class Stmt {
  constructor(private readonly sql: string) {}
  bind() {
    return this;
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM approval_instance WHERE id")) {
      return dbState.instance as T | null;
    }
    if (this.sql.includes("FROM approval_template WHERE id")) {
      return { id: 7, name: "付款审批", nodes_json: "[]" } as T;
    }
    if (this.sql.includes("COUNT")) return { total: 0 } as T;
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes("FROM approval_task")) {
      return { results: dbState.tasks as T[] };
    }
    return { results: [] as T[] };
  }
  async run() {
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

const createEnv = () =>
  ({
    DB: { prepare: (sql: string) => new Stmt(sql) },
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env;

const requestDetail = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/approval", approvalRoutes);
  return app.request(
    "/approval/42",
    { headers: { authorization: "Bearer test-token" } },
    createEnv()
  );
};

const setAuth = (sub: string, roles: UserRole[]) => {
  mockAuthState.payload = { ...mockAuthState.payload, sub, roles };
};

describe("GET /approval/:id view authorization", () => {
  beforeEach(() => {
    dbState.instance = defaultInstance();
    dbState.tasks = defaultTasks();
    setAuth("someone", ["operator"]);
  });

  describe("authorized viewers → 200", () => {
    it("allows super_admin (monitoring)", async () => {
      setAuth("outsider", ["super_admin"]);
      const res = await requestDetail();
      expect(res.status).toBe(200);
    });

    it("allows manager (monitoring)", async () => {
      setAuth("outsider", ["manager"]);
      const res = await requestDetail();
      expect(res.status).toBe(200);
    });

    it("allows the initiator", async () => {
      setAuth("alice", ["operator"]);
      const res = await requestDetail();
      expect(res.status).toBe(200);
    });

    it("allows a current/historical approver (assignee)", async () => {
      setAuth("bob", ["operator"]);
      const res = await requestDetail();
      expect(res.status).toBe(200);
    });

    it("allows a cc recipient", async () => {
      setAuth("carol", ["operator"]);
      const res = await requestDetail();
      expect(res.status).toBe(200);
    });
  });

  describe("unauthorized viewers → 403", () => {
    it("rejects an unrelated operator", async () => {
      setAuth("mallory", ["operator"]);
      const res = await requestDetail();
      expect(res.status).toBe(403);
    });

    it("rejects an unrelated site_manager", async () => {
      setAuth("mallory", ["site_manager"]);
      const res = await requestDetail();
      expect(res.status).toBe(403);
    });
  });

  it("returns 404 when the instance does not exist", async () => {
    dbState.instance = null;
    setAuth("mallory", ["operator"]);
    const res = await requestDetail();
    expect(res.status).toBe(404);
  });
});
