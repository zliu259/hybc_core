import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import type { Env } from "../types/env";
import { adminRoutes } from "./admin";

// 背景（2026-09-13）：AI 关卡拦截转人工需要一位系统级兜底审核人。该配置只有超管能读写，
// 且必须落在企业微信通讯录里、解析出来确实是超管——否则拦截时会把单子转给一个不存在
// 或无权处置的人。企微不可用导致「核对不了角色」与「核对出来不是超管」是两回事，
// 前者要如实报出来让人重试，不能悄悄当成后者。

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "boss-a",
    username: "boss-a",
    nickname: "Boss A",
    avatar: "",
    roles: ["super_admin"],
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

const deps = vi.hoisted(() => ({
  roleByUser: new Map<string, string | null>([
    ["Boss", "super_admin"],
    ["Mgr", "manager"]
  ]),
  /** 角色解析直接抛错的用户（模拟企微接口不可用），值即错误信息；每个用例可覆写 */
  roleErrorByUser: new Map<string, string>(),
  /** 通讯录整体拉取失败开关 */
  contactBookThrows: false,
  contactBookError: "wecom contact book unavailable",
  contacts: [
    { userid: "Boss", name: "刘老板", department: [1] },
    { userid: "Mgr", name: "王经理", department: [1] },
    { userid: "Flaky", name: "赵抖动", department: [1] }
  ]
}));

vi.mock("../services/wecom-role", () => ({
  resolveSystemRoleForUser: async (_env: unknown, userid: string) => {
    const failure = deps.roleErrorByUser.get(userid);
    if (failure) throw new Error(failure);
    return deps.roleByUser.get(userid) ?? null;
  }
}));

vi.mock("../services/wecom-contact-book", () => ({
  getWeComContactBook: async () => {
    if (deps.contactBookThrows) throw new Error(deps.contactBookError);
    return {
      syncedAt: "2026-09-14T00:00:00.000Z",
      departments: [],
      users: deps.contacts
    };
  }
}));

// 上游异常都会 console.error 全文（只进服务端日志），测试里静音并借它断言「确实记了」
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
afterAll(() => {
  consoleErrorSpy.mockRestore();
});

const CONFIG_KEY = "approval.ai_gate.fallback_reviewer_userid";

class SettingsStatement {
  private params: unknown[] = [];
  constructor(
    private readonly db: SettingsDb,
    private readonly sql: string
  ) {}
  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  async first<T>(): Promise<T | null> {
    if (/FROM\s+system_config/i.test(this.sql)) {
      const row = this.db.config.get(String(this.params[0]));
      return (row ?? null) as unknown as T;
    }
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] as T[] };
  }
  async run() {
    this.db.runs.push({ sql: this.sql, params: this.params });
    if (/INSERT\s+INTO\s+system_config/i.test(this.sql)) {
      this.db.config.set(String(this.params[0]), {
        config_value: String(this.params[1]),
        updated_by: String(this.params[2]),
        updated_at: String(this.params[4])
      });
    }
    return { meta: { last_row_id: 1, changes: 1 } };
  }
}

class SettingsDb {
  readonly runs: Array<{ sql: string; params: unknown[] }> = [];
  readonly config = new Map<
    string,
    { config_value: string; updated_by: string | null; updated_at: string }
  >();
  prepare(sql: string) {
    return new SettingsStatement(this, sql);
  }
}

const createApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/admin", adminRoutes);
  return app;
};

const createEnv = (db: SettingsDb) =>
  ({
    DB: db,
    KV: {
      async get() {
        return "session";
      }
    }
  }) as unknown as Env & { DB: SettingsDb };

const call = (env: Env, method: "GET" | "PUT", body?: Record<string, unknown>) =>
  createApp().request(
    "/admin/approval-ai-gate/settings",
    {
      method,
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    },
    env
  );

describe("AI 关卡兜底审核人设置", () => {
  beforeEach(() => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["super_admin"] };
    deps.roleErrorByUser.clear();
    deps.roleErrorByUser.set("Flaky", "wecom timeout");
    deps.contactBookThrows = false;
    consoleErrorSpy.mockClear();
  });

  it("非超管 403", async () => {
    mockAuthState.payload = { ...mockAuthState.payload, roles: ["manager"] };
    const res = await call(createEnv(new SettingsDb()), "GET");
    expect(res.status).toBe(403);
  });

  it("GET 未配置返回空值", async () => {
    const res = await call(createEnv(new SettingsDb()), "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "",
      fallback_reviewer_name: null,
      fallback_reviewer_role: null
    });
  });

  it("PUT 非通讯录成员 400", async () => {
    const env = createEnv(new SettingsDb());
    const res = await call(env, "PUT", { fallback_reviewer_userid: "Ghost" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("通讯录");
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(false);
  });

  it("PUT 非超管成员 400 并带当前角色", async () => {
    const res = await call(createEnv(new SettingsDb()), "PUT", { fallback_reviewer_userid: "Mgr" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("manager");
  });

  it("PUT 成功：upsert + 审计；GET 回读含姓名与角色", async () => {
    const env = createEnv(new SettingsDb());
    const put = await call(env, "PUT", { fallback_reviewer_userid: " Boss " });
    expect(put.status).toBe(200);
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(true);
    const audit = env.DB.runs.find((r) => /INSERT\s+INTO\s+api_audit_log/i.test(r.sql));
    expect(audit?.params[2]).toBe("admin.ai_gate_fallback_reviewer.update");

    const get = await call(env, "GET");
    const body = (await get.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "Boss",
      fallback_reviewer_name: "刘老板",
      fallback_reviewer_role: "super_admin",
      role_check_error: null,
      contact_check_error: null,
      updated_by: "boss-a"
    });
  });

  it("PUT 空串清除配置并审计", async () => {
    const env = createEnv(new SettingsDb());
    env.DB.config.set(CONFIG_KEY, {
      config_value: "Boss",
      updated_by: "boss-a",
      updated_at: "2026-09-14T00:00:00.000Z"
    });
    const res = await call(env, "PUT", { fallback_reviewer_userid: "" });
    expect(res.status).toBe(200);
    expect(env.DB.config.get(CONFIG_KEY)?.config_value).toBe("");
    const audit = env.DB.runs.find((r) => /INSERT\s+INTO\s+api_audit_log/i.test(r.sql));
    expect(String(audit?.params[6])).toContain('"previous":"Boss"');

    // 清除后配置行仍在（值为空串），GET 要能读回，并保留是谁在什么时候清的
    const get = await call(env, "GET");
    const body = (await get.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "",
      updated_by: "boss-a"
    });
  });

  it("GET 角色核对失败：角色留空但报出原因，姓名照常解析", async () => {
    const env = createEnv(new SettingsDb());
    env.DB.config.set(CONFIG_KEY, {
      config_value: "Flaky",
      updated_by: "boss-a",
      updated_at: "2026-09-14T00:00:00.000Z"
    });
    const res = await call(env, "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "Flaky",
      fallback_reviewer_name: "赵抖动",
      fallback_reviewer_role: null,
      role_check_error: "wecom timeout"
    });
  });

  it("PUT 角色核对失败 400：不能把「核对不了」当成「不是超管」", async () => {
    const env = createEnv(new SettingsDb());
    const res = await call(env, "PUT", { fallback_reviewer_userid: "Flaky" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("无法核对");
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(false);
  });

  it.each<Record<string, unknown>>([
    {},
    { fallback_reviewer_userid: 123 },
    { fallback_reviewer_userid: null }
  ])("PUT 坏请求体 %j 一律 400，且绝不当成清除", async (payload) => {
    const env = createEnv(new SettingsDb());
    const res = await call(env, "PUT", payload);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("必须是字符串");
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(false);
  });

  it("PUT 超长 userid 400", async () => {
    const env = createEnv(new SettingsDb());
    const res = await call(env, "PUT", { fallback_reviewer_userid: "x".repeat(65) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("长度超限");
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(false);
  });

  it("GET 上游报错脱敏：URL 与头部回显里的密钥都不得回给前端", async () => {
    const env = createEnv(new SettingsDb());
    env.DB.config.set(CONFIG_KEY, {
      config_value: "Flaky",
      updated_by: "boss-a",
      updated_at: "2026-09-14T00:00:00.000Z"
    });
    deps.roleErrorByUser.set(
      "Flaky",
      "bridge response 500: https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=ww1&corpsecret=SECRET123"
    );

    const res = await call(env, "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    const message = String(body.data.role_check_error);
    expect(message).toContain("corpsecret=***");
    expect(message).not.toContain("SECRET123");
    // 全文只进服务端日志
    expect(consoleErrorSpy).toHaveBeenCalled();

    // URL 之外，响应头/JSON 形态的回显（key: value）同样要盖掉
    deps.roleErrorByUser.set("Flaky", "x-bridge-token: BRIDGE123");
    const headerRes = await call(env, "GET");
    const headerBody = (await headerRes.json()) as { data: Record<string, unknown> };
    expect(String(headerBody.data.role_check_error)).not.toContain("BRIDGE123");
  });

  it("GET 通讯录拉取失败：姓名留空但报出原因，不静默吞掉", async () => {
    const env = createEnv(new SettingsDb());
    env.DB.config.set(CONFIG_KEY, {
      config_value: "Boss",
      updated_by: "boss-a",
      updated_at: "2026-09-14T00:00:00.000Z"
    });
    deps.contactBookThrows = true;

    const res = await call(env, "GET");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      fallback_reviewer_userid: "Boss",
      fallback_reviewer_name: null,
      fallback_reviewer_role: "super_admin",
      contact_check_error: "wecom contact book unavailable"
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("PUT 通讯录拉取失败 400：核对不了就不落库", async () => {
    const env = createEnv(new SettingsDb());
    deps.contactBookThrows = true;

    const res = await call(env, "PUT", { fallback_reviewer_userid: "Boss" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("无法核对通讯录");
    expect(env.DB.runs.some((r) => /INSERT\s+INTO\s+system_config/i.test(r.sql))).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
