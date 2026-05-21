import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import { wecomToolRoutes } from "./wecom-tools";

type AuditInsert = {
  tool_name: string;
  status: string;
  response_summary: string | null;
};

class WeComToolStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: WeComToolRouteDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>();
  }

  async run(): Promise<{ meta: { last_row_id: number; changes?: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class WeComToolRouteDb {
  readonly audits: AuditInsert[] = [];

  prepare(sql: string) {
    return new WeComToolStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM project_wecom_bot_binding") && sql.includes("group_chat_id = ?")) {
      return {
        id: 1,
        project_id: 7,
        binding_name: "东线项目群",
        group_chat_id: String(params[0]),
        bot_id: null,
        allowed_tools_json: '["get_project_overview"]',
        data_scope: "project",
        push_webhook_secret_ref: "prod-east",
        push_enabled: 1,
        qa_enabled: 1,
        status: "active",
        created_by: "manager-a",
        created_at: "2026-05-18T08:00:00.000Z",
        updated_at: "2026-05-18T08:00:00.000Z"
      } as T;
    }

    if (sql.includes("FROM project WHERE id = ?")) {
      return {
        id: Number(params[0]),
        project_code: "P-001",
        project_name: "东线顶管项目",
        manager_userid: "manager-a",
        status: "active",
        location_text: "广州",
        start_date: "2026-05-01",
        end_date: null,
        updated_at: "2026-05-18T08:00:00.000Z"
      } as T;
    }

    if (sql.includes("COUNT(*) AS section_count")) {
      return { section_count: 2 } as T;
    }

    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes("INSERT INTO wecom_tool_call_audit")) {
      this.audits.push({
        tool_name: String(params[2]),
        response_summary: (params[6] as string | null) ?? null,
        status: String(params[7])
      });
      return { meta: { last_row_id: this.audits.length, changes: 1 } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

class WeComToolRouteKv {
  constructor(private readonly values: Record<string, string | null> = {}) {}

  async get(key: string): Promise<string | null> {
    return this.values[key] ?? null;
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/wecom", wecomToolRoutes);
  return app;
};

const createEnv = (options: { envToken?: string; kvToken?: string | null } = {}) =>
  ({
    DB: new WeComToolRouteDb(),
    KV: new WeComToolRouteKv(
      options.kvToken === undefined ? {} : { "wecom:tool-token": options.kvToken }
    ),
    WECOM_BOT_TOOL_TOKEN: options.envToken ?? "secret-token"
  }) as unknown as Env & { DB: WeComToolRouteDb };

describe("wecom tool routes", () => {
  it("returns health without a token", async () => {
    const res = await createApp().request("/wecom/tools/health", {}, createEnv());
    const json = (await res.json()) as { success: boolean; data: { status: string } };

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, data: { status: "ok" } });
  });

  it("requires token for tool calls", async () => {
    const res = await createApp().request(
      "/wecom/tools/call",
      {
        method: "POST",
        body: JSON.stringify({ tool: "get_project_overview", input: { project_id: 7 } })
      },
      createEnv()
    );

    expect(res.status).toBe(401);
  });

  it("returns a tool manifest", async () => {
    const res = await createApp().request(
      "/wecom/tools/manifest",
      { headers: { "x-wecom-tool-token": "secret-token" } },
      createEnv()
    );
    const json = (await res.json()) as {
      data: { tools: Array<{ name: string; access: string }> };
    };

    expect(res.status).toBe(200);
    expect(json.data.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "get_project_overview",
          access: "read"
        })
      ])
    );
  });

  it("calls an allowed tool and writes audit", async () => {
    const env = createEnv();
    const res = await createApp().request(
      "/wecom/tools/call",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wecom-tool-token": "secret-token"
        },
        body: JSON.stringify({
          tool: "get_project_overview",
          input: { project_id: 7 },
          context: { group_chat_id: "wr-group-1", caller_userid: "operator-a" }
        })
      },
      env
    );
    const json = (await res.json()) as {
      data: { project_id: number; project_name: string; section_count: number };
    };

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      project_id: 7,
      project_name: "东线顶管项目",
      section_count: 2
    });
    expect(env.DB.audits).toEqual([
      expect.objectContaining({
        tool_name: "get_project_overview",
        status: "success"
      })
    ]);
  });

  it("accepts a front-end configured KV tool token", async () => {
    const env = createEnv({ envToken: "", kvToken: "kv-secret-token" });
    const res = await createApp().request(
      "/wecom/tools/call",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wecom-tool-token": "kv-secret-token"
        },
        body: JSON.stringify({
          tool: "get_project_overview",
          input: { project_id: 7 },
          context: { group_chat_id: "wr-group-1" }
        })
      },
      env
    );

    expect(res.status).toBe(200);
  });

  it("rejects tools not allowed by the group binding", async () => {
    const res = await createApp().request(
      "/wecom/tools/call",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wecom-tool-token": "secret-token"
        },
        body: JSON.stringify({
          tool: "get_latest_manager_logs",
          input: { project_id: 7 },
          context: { group_chat_id: "wr-group-1" }
        })
      },
      createEnv()
    );

    expect(res.status).toBe(403);
  });
});
