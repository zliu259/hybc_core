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
  readonly publicLogLinks: Array<Record<string, unknown>> = [];

  constructor(private publicLogLinkToken: string | null = "public-token") {}

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
        source_type: "internal",
        external_submission_id: null,
        external_submitter_name: null,
        external_submitter_company: null,
        updated_at: "2026-05-18T09:00:00.000Z"
      } as T;
    }

    if (sql.includes("FROM operator_log") && sql.includes("WHERE l.id = ?")) {
      return {
        id: Number(params[0]),
        project_id: 7,
        section_id: 3,
        log_date: "2026-05-18",
        shift: "night",
        weather: "晴",
        completed_pipe_count: 4,
        cumulative_pipe_count: 43,
        footage_m: 12,
        cumulative_footage_m: 130,
        main_thrust_mpa: null,
        main_thrust_text: "4×12Mpa",
        chamber_pressure_mpa: 0.05,
        cutter_current_a: null,
        cutter_current_text: "2*35A",
        cutter_frequency_hz: 50,
        soil_type: "卵石破碎",
        deviation_direction: null,
        deviation_value_mm: null,
        horizontal_deviation_direction: "right",
        horizontal_deviation_mm: 5,
        vertical_deviation_direction: "high",
        vertical_deviation_mm: 5,
        issue_summary: "接力泵漏水",
        remark: "耽误一小时，正常顶进",
        operator_userid: "operator-a",
        source_type: "external",
        external_submission_id: 88,
        external_submitter_name: "外包张三",
        external_submitter_company: "顶管分包队",
        status: "submitted",
        updated_at: "2026-05-18T09:00:00.000Z",
        section_code: "S-01",
        section_name: "北线 DN1600"
      } as T;
    }

    if (sql.includes("FROM external_log_submission WHERE id = ?")) {
      return {
        id: Number(params[0]),
        photo_keys_json: JSON.stringify(["external-log/7/photo-a.jpg"])
      } as T;
    }

    if (sql.includes("FROM project_public_log_link")) {
      if (!this.publicLogLinkToken) return null;
      return {
        id: 10,
        project_id: 7,
        token: this.publicLogLinkToken,
        allowed_log_types_json: JSON.stringify(["operator_log", "project_log"]),
        expires_at: null,
        status: "active"
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

    if (sql.includes("FROM manager_log_photo")) {
      return {
        results: [
          {
            id: 1,
            manager_log_id: Number(params[0]),
            file_key: "manager-log/7/photo-a.jpg",
            caption: "现场照片",
            sort_order: 0,
            status: "active",
            created_at: "2026-05-18T09:00:00.000Z"
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

    if (sql.includes("UPDATE project_public_log_link SET status = 'revoked'")) {
      return { meta: { last_row_id: 0, changes: 0 } };
    }

    if (sql.includes("INSERT INTO project_public_log_link")) {
      this.publicLogLinkToken = String(params[1]);
      this.publicLogLinks.push({
        project_id: params[0],
        token: params[1],
        token_hash: params[2],
        allowed_log_types_json: params[3],
        created_by_userid: params[4]
      });
      return { meta: { last_row_id: this.publicLogLinks.length + 10, changes: 1 } };
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
  webhook: string | null = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc",
  options: { publicLogLinkToken?: string | null } = {}
) =>
  ({
    DB: new PushDb(
      options.publicLogLinkToken === undefined ? "public-token" : options.publicLogLinkToken
    ),
    KV: new PushKv({ "wecom:group-webhook:prod-east": webhook }),
    WECHAT_REDIRECT_URI: "https://web.example.com/login",
    WECOM_PUSH_API_BASE_URL: "https://api.example.com"
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
    const content = (sent[0].body.markdown as { content: string }).content;
    expect(content).toContain("现场照片");
    expect(content).toContain(
      "https://api.example.com/api/v1/upload/object/manager-log%2F7%2Fphoto-a.jpg"
    );
    expect(content).toContain(
      "https://web.example.com/#/public/project-log/public-token?mode=view_project"
    );
    expect(env.DB.events[0]).toMatchObject({
      status: "sent",
      source_event_type: "MANAGER_LOG_CREATED",
      source_biz_id: 21
    });
  });

  it("sends operator log markdown to active project group webhooks", async () => {
    const env = createEnv();
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

    await pushProjectLogEventToWeComGroups(
      env,
      {
        event_type: "OPERATOR_LOG_CREATED",
        project_id: 7,
        operator_log_id: 31
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
    const content = (sent[0].body.markdown as { content: string }).content;
    expect(content).toContain("施工日志新增");
    expect(content).toContain("北线 DN1600");
    expect(content).toContain("本班顶进：12m");
    expect(content).toContain(
      "https://web.example.com/#/public/project-log/public-token?mode=view_operator&section_id=3"
    );
    expect(env.DB.events[0]).toMatchObject({
      status: "sent",
      source_event_type: "OPERATOR_LOG_CREATED",
      source_biz_type: "operator_log",
      source_biz_id: 31
    });
  });

  it("creates a public log link before pushing when the project does not have one", async () => {
    const env = createEnv("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc", {
      publicLogLinkToken: null
    });
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

    await pushProjectLogEventToWeComGroups(
      env,
      {
        event_type: "OPERATOR_LOG_CREATED",
        project_id: 7,
        operator_log_id: 31
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

    expect(env.DB.publicLogLinks).toHaveLength(1);
    expect(env.DB.publicLogLinks[0]).toMatchObject({
      project_id: 7,
      allowed_log_types_json: JSON.stringify(["operator_log", "project_log"]),
      created_by_userid: "system"
    });
    const token = String(env.DB.publicLogLinks[0].token);
    const content = (sent[0].body.markdown as { content: string }).content;
    expect(content).toContain(
      `https://web.example.com/#/public/project-log/${token}?mode=view_operator&section_id=3`
    );
  });

  it("sends both adopted external project and operator logs with source photos", async () => {
    const env = createEnv();
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

    await pushProjectLogEventToWeComGroups(
      env,
      {
        event_type: "EXTERNAL_LOG_ADOPTED",
        project_id: 7,
        manager_log_id: 21,
        operator_log_id: 31,
        external_submission_id: 88
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

    expect(sent).toHaveLength(2);
    const contents = sent.map((item) => (item.body.markdown as { content: string }).content);
    expect(contents[0]).toContain("外部项目日志采纳");
    expect(contents[1]).toContain("外部施工日志采纳");
    expect(contents[1]).toContain("外包张三");
    expect(contents[1]).toContain(
      "https://api.example.com/api/v1/upload/object/external-log%2F7%2Fphoto-a.jpg"
    );
    expect(env.DB.events).toHaveLength(2);
    expect(env.DB.events[0]).toMatchObject({
      source_event_type: "EXTERNAL_LOG_ADOPTED",
      source_biz_type: "manager_log",
      source_biz_id: 21
    });
    expect(env.DB.events[1]).toMatchObject({
      source_event_type: "EXTERNAL_LOG_ADOPTED",
      source_biz_type: "operator_log",
      source_biz_id: 31
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

  it("fails test messages when the webhook secret cannot be resolved", async () => {
    const env = createEnv(null);

    await expect(sendProjectWeComBindingTestMessage(env, 1)).rejects.toThrow(
      "Webhook secret not found"
    );
    expect(env.DB.events[0]).toMatchObject({
      status: "failed",
      source_event_type: "TEST_SEND",
      error_message: "Webhook secret not found"
    });
  });
});
