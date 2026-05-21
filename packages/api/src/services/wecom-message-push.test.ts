import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import {
  pushProjectLogEventToWeComGroups,
  sendProjectWeComBindingTestMessage
} from "./wecom-message-push";

class PushStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: PushDb,
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

class PushDb {
  readonly events: Array<Record<string, unknown>> = [];

  prepare(sql: string) {
    return new PushStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM project_wecom_bot_binding WHERE id = ?")) {
      return {
        id: Number(params[0]),
        project_id: 7,
        binding_name: "东线项目群",
        group_chat_id: "wr-group-1",
        bot_id: null,
        allowed_tools_json: "[]",
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
        project_name: "东线顶管项目"
      } as T;
    }

    if (sql.includes("FROM manager_log WHERE id = ?")) {
      return {
        id: Number(params[0]),
        project_id: 7,
        log_date: "2026-05-18",
        title: "今日进展",
        detail_html: "<p>完成 12 米</p>",
        risk_note: "注意沉降监测",
        status: "published",
        updated_at: "2026-05-18T09:00:00.000Z"
      } as T;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM project_wecom_bot_binding")) {
      return {
        results: [
          {
            id: 1,
            project_id: Number(params[0]),
            binding_name: "东线项目群",
            group_chat_id: "wr-group-1",
            bot_id: null,
            allowed_tools_json: "[]",
            data_scope: "project",
            push_webhook_secret_ref: "prod-east",
            push_enabled: 1,
            qa_enabled: 1,
            status: "active",
            created_by: "manager-a",
            created_at: "2026-05-18T08:00:00.000Z",
            updated_at: "2026-05-18T08:00:00.000Z"
          }
        ] as T[]
      };
    }

    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    if (sql.includes("INSERT OR IGNORE INTO project_wecom_push_event")) {
      this.events.push({
        binding_id: params[0],
        project_id: params[1],
        source_event_type: params[2],
        source_biz_type: params[3],
        source_biz_id: params[4],
        message_type: "markdown",
        message_summary: params[5],
        status: params[6],
        error_message: params[7],
        webhook_secret_ref: params[8]
      });
      return { meta: { last_row_id: this.events.length, changes: 1 } };
    }

    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

class PushKv {
  constructor(private readonly values: Record<string, string | null>) {}

  async get(key: string): Promise<string | null> {
    return this.values[key] ?? null;
  }
}

const createEnv = (
  webhook: string | null = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"
) =>
  ({
    DB: new PushDb(),
    KV: new PushKv({ "wecom:group-webhook:prod-east": webhook })
  }) as unknown as Env & { DB: PushDb };

class MissingMigrationDb {
  prepare() {
    throw new Error("no such table: project_wecom_bot_binding");
  }
}

describe("wecom message push", () => {
  it("skips project log push when the WeCom migration is not applied yet", async () => {
    const env = {
      DB: new MissingMigrationDb(),
      KV: new PushKv({})
    } as unknown as Env;

    await expect(
      pushProjectLogEventToWeComGroups(env, {
        event_type: "MANAGER_LOG_CREATED",
        project_id: 7,
        manager_log_id: 21
      })
    ).resolves.toBeUndefined();
  });

  it("sends manager log markdown to active project group webhooks", async () => {
    const env = createEnv();
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

    await pushProjectLogEventToWeComGroups(
      env,
      {
        event_type: "MANAGER_LOG_CREATED",
        project_id: 7,
        manager_log_id: 21
      },
      {
        fetcher: async (url, init) => {
          sent.push({
            url: String(url),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>
          });
          return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
        }
      }
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      msgtype: "markdown",
      markdown: {
        content: expect.stringContaining("东线顶管项目")
      }
    });
    expect(env.DB.events[0]).toMatchObject({
      status: "sent",
      source_event_type: "MANAGER_LOG_CREATED",
      source_biz_id: 21
    });
  });

  it("records failure when webhook secret is missing", async () => {
    const env = createEnv(null);

    await pushProjectLogEventToWeComGroups(env, {
      event_type: "MANAGER_LOG_CREATED",
      project_id: 7,
      manager_log_id: 21
    });

    expect(env.DB.events[0]).toMatchObject({
      status: "failed",
      error_message: "Webhook secret not found"
    });
  });

  it("sends a test markdown message for a single binding", async () => {
    const env = createEnv();
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

    await sendProjectWeComBindingTestMessage(env, 1, {
      fetcher: async (url, init) => {
        sent.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>
        });
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
      }
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      msgtype: "markdown",
      markdown: {
        content: expect.stringContaining("测试推送")
      }
    });
    expect(env.DB.events[0]).toMatchObject({
      status: "sent",
      source_event_type: "TEST_SEND",
      source_biz_type: "test_send",
      source_biz_id: 1
    });
  });
});
