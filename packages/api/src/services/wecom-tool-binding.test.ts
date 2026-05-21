import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import {
  createProjectWeComBinding,
  disableProjectWeComBinding,
  listProjectWeComBindings,
  listProjectWeComPushEvents,
  listWeComToolCallAudits,
  resolveBindingForToolCall,
  updateProjectWeComBinding
} from "./wecom-tool-binding";

type BindingRow = {
  id: number;
  project_id: number;
  binding_name: string;
  group_chat_id: string | null;
  bot_id: string | null;
  allowed_tools_json: string;
  data_scope: string;
  push_webhook_secret_ref: string | null;
  push_enabled: 0 | 1;
  qa_enabled: 0 | 1;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

class BindingStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: BindingDb,
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
    return this.db.all<T>(this.sql, this.params);
  }

  async run(): Promise<{ meta: { last_row_id: number; changes?: number } }> {
    return this.db.run(this.sql, this.params);
  }
}

class BindingDb {
  rows: BindingRow[] = [];
  audits = [
    {
      id: 1,
      binding_id: 1,
      project_id: 7,
      tool_name: "get_project_overview",
      caller_userid: "operator-a",
      group_chat_id: "wr-group-1",
      request_json: "{}",
      response_summary: "{}",
      status: "success",
      error_message: null,
      latency_ms: 12,
      created_at: "2026-05-18T09:00:00.000Z"
    }
  ];
  pushEvents = [
    {
      id: 1,
      binding_id: 1,
      project_id: 7,
      source_event_type: "MANAGER_LOG_CREATED",
      source_biz_type: "manager_log",
      source_biz_id: 21,
      message_type: "markdown",
      message_summary: "项目日志新增",
      status: "sent",
      error_message: null,
      webhook_secret_ref: "prod-east",
      retry_count: 0,
      pushed_at: "2026-05-18T09:00:00.000Z",
      created_at: "2026-05-18T09:00:00.000Z",
      updated_at: "2026-05-18T09:00:00.000Z"
    }
  ];
  private nextId = 1;

  prepare(sql: string) {
    return new BindingStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM project_wecom_bot_binding WHERE id = ?")) {
      return (this.rows.find((row) => row.id === Number(params[0])) as T | undefined) ?? null;
    }

    if (sql.includes("FROM project_wecom_bot_binding") && sql.includes("group_chat_id = ?")) {
      const groupChatId = String(params[0]);
      return (
        (this.rows.find(
          (row) =>
            row.group_chat_id === groupChatId && row.status === "active" && row.qa_enabled === 1
        ) as T | undefined) ?? null
      );
    }

    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM project_wecom_bot_binding WHERE project_id = ?")) {
      const projectId = Number(params[0]);
      return {
        results: this.rows.filter(
          (row) => row.project_id === projectId && row.status !== "deleted"
        ) as T[]
      };
    }

    if (sql.includes("FROM wecom_tool_call_audit")) {
      const projectId = Number(params[0]);
      return {
        results: this.audits.filter((row) => row.project_id === projectId) as T[]
      };
    }

    if (sql.includes("FROM project_wecom_push_event")) {
      const projectId = Number(params[0]);
      return {
        results: this.pushEvents.filter((row) => row.project_id === projectId) as T[]
      };
    }

    throw new Error(`Unhandled all SQL: ${sql}`);
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes("INSERT INTO project_wecom_bot_binding")) {
      const row: BindingRow = {
        id: this.nextId++,
        project_id: Number(params[0]),
        binding_name: String(params[1]),
        group_chat_id: (params[2] as string | null) ?? null,
        bot_id: (params[3] as string | null) ?? null,
        allowed_tools_json: String(params[4]),
        data_scope: String(params[5]),
        push_webhook_secret_ref: (params[6] as string | null) ?? null,
        push_enabled: params[7] as 0 | 1,
        qa_enabled: params[8] as 0 | 1,
        status: "active",
        created_by: (params[9] as string | null) ?? null,
        created_at: String(params[10]),
        updated_at: String(params[11])
      };
      this.rows.push(row);
      return { meta: { last_row_id: row.id, changes: 1 } };
    }

    if (sql.includes("UPDATE project_wecom_bot_binding SET status = 'disabled'")) {
      const id = Number(params[1]);
      const row = this.rows.find((item) => item.id === id);
      if (row) {
        row.status = "disabled";
        row.updated_at = String(params[0]);
      }
      return { meta: { last_row_id: 0, changes: row ? 1 : 0 } };
    }

    if (sql.includes("UPDATE project_wecom_bot_binding SET")) {
      const id = Number(params[9]);
      const row = this.rows.find((item) => item.id === id);
      if (row) {
        row.binding_name = String(params[0]);
        row.group_chat_id = (params[1] as string | null) ?? null;
        row.bot_id = (params[2] as string | null) ?? null;
        row.allowed_tools_json = String(params[3]);
        row.data_scope = String(params[4]);
        row.push_webhook_secret_ref = (params[5] as string | null) ?? null;
        row.push_enabled = params[6] as 0 | 1;
        row.qa_enabled = params[7] as 0 | 1;
        row.updated_at = String(params[8]);
      }
      return { meta: { last_row_id: 0, changes: row ? 1 : 0 } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

class MissingBindingMigrationDb {
  prepare() {
    throw new Error("no such table: project_wecom_bot_binding");
  }
}

const createEnv = () => ({ DB: new BindingDb() }) as unknown as Env & { DB: BindingDb };

describe("wecom tool binding service", () => {
  it("creates bindings with read-only allowed tools only", async () => {
    const env = createEnv();

    const binding = await createProjectWeComBinding(
      env,
      {
        project_id: 7,
        binding_name: "东线项目群",
        group_chat_id: "wr-group-1",
        allowed_tools: ["get_project_overview", "unknown_tool", "create_manager_log_draft"],
        push_enabled: false,
        qa_enabled: true
      },
      "manager-a"
    );

    expect(binding.id).toBe(1);
    expect(JSON.parse(binding.allowed_tools_json)).toEqual(["get_project_overview"]);
    expect(binding.created_by).toBe("manager-a");
  });

  it("requires a webhook secret ref when push is enabled", async () => {
    const env = createEnv();

    await expect(
      createProjectWeComBinding(env, {
        project_id: 7,
        binding_name: "东线项目群",
        group_chat_id: "wr-group-1",
        push_enabled: true,
        qa_enabled: true
      })
    ).rejects.toThrow("push_webhook_secret_ref is required");
  });

  it("rejects full webhook URLs as webhook secret refs", async () => {
    const env = createEnv();

    await expect(
      createProjectWeComBinding(env, {
        project_id: 7,
        binding_name: "东线项目群",
        group_chat_id: "wr-group-1",
        push_webhook_secret_ref: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc",
        push_enabled: true,
        qa_enabled: true
      })
    ).rejects.toThrow("push_webhook_secret_ref must be a saved secret ref");
  });

  it("requires group or bot identity when qa is enabled", async () => {
    const env = createEnv();

    await expect(
      createProjectWeComBinding(env, {
        project_id: 7,
        binding_name: "东线项目群",
        push_enabled: false,
        qa_enabled: true
      })
    ).rejects.toThrow("group_chat_id or bot_id is required");
  });

  it("resolves active group bindings only when the tool is allowed", async () => {
    const env = createEnv();
    await createProjectWeComBinding(env, {
      project_id: 7,
      binding_name: "东线项目群",
      group_chat_id: "wr-group-1",
      allowed_tools: ["get_project_overview"],
      push_enabled: false,
      qa_enabled: true
    });

    const resolved = await resolveBindingForToolCall(env, {
      tool: "get_project_overview",
      context: { group_chat_id: "wr-group-1" }
    });

    expect(resolved.project_id).toBe(7);

    await expect(
      resolveBindingForToolCall(env, {
        tool: "get_latest_manager_logs",
        context: { group_chat_id: "wr-group-1" }
      })
    ).rejects.toThrow("Tool is not allowed");
  });

  it("stops resolving disabled bindings", async () => {
    const env = createEnv();
    const binding = await createProjectWeComBinding(env, {
      project_id: 7,
      binding_name: "东线项目群",
      group_chat_id: "wr-group-1",
      push_enabled: false,
      qa_enabled: true
    });

    await disableProjectWeComBinding(env, binding.id);

    await expect(
      resolveBindingForToolCall(env, {
        tool: "get_project_overview",
        context: { group_chat_id: "wr-group-1" }
      })
    ).rejects.toThrow("Active WeCom binding not found");
  });

  it("updates binding fields and keeps only read-only tools", async () => {
    const env = createEnv();
    const binding = await createProjectWeComBinding(env, {
      project_id: 7,
      binding_name: "东线项目群",
      group_chat_id: "wr-group-1",
      push_enabled: false,
      qa_enabled: true
    });

    const updated = await updateProjectWeComBinding(env, binding.id, {
      project_id: 7,
      binding_name: "东线项目群-更新",
      group_chat_id: "wr-group-2",
      allowed_tools: ["get_project_overview", "update_section_mileage"],
      push_webhook_secret_ref: "prod-east",
      push_enabled: true,
      qa_enabled: true
    });

    expect(updated.binding_name).toBe("东线项目群-更新");
    expect(updated.group_chat_id).toBe("wr-group-2");
    expect(updated.push_enabled).toBe(1);
    expect(JSON.parse(updated.allowed_tools_json)).toEqual(["get_project_overview"]);
  });

  it("lists tool call audits and push events for a project", async () => {
    const env = createEnv();

    const audits = await listWeComToolCallAudits(env, 7);
    const events = await listProjectWeComPushEvents(env, 7);

    expect(audits[0]).toMatchObject({
      tool_name: "get_project_overview",
      status: "success"
    });
    expect(events[0]).toMatchObject({
      source_event_type: "MANAGER_LOG_CREATED",
      status: "sent"
    });
  });

  it("returns empty lists when the WeCom migration is not applied yet", async () => {
    const env = { DB: new MissingBindingMigrationDb() } as unknown as Env;

    await expect(listProjectWeComBindings(env, 7)).resolves.toEqual([]);
    await expect(listWeComToolCallAudits(env, 7)).resolves.toEqual([]);
    await expect(listProjectWeComPushEvents(env, 7)).resolves.toEqual([]);
  });
});
