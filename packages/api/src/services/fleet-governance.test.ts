import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthTokenPayload } from "../types/auth";
import {
  appendApiAuditLog,
  assertFuelApplicationTransition,
  buildFuelRiskSummary,
  createFleetNotificationRecord,
  evaluateFuelApplicationRules,
  listEnabledFleetFuelRulePolicies,
  replaceFuelQuotaRuleHits,
  type FuelApplicationStatus,
  type FuelQuotaRuleHitDraft,
  type FleetFuelRulePolicy
} from "./fleet-governance";
import type { Env } from "../types/env";
import { fleetRoutes } from "../routes/fleet";

const mockAuthState = vi.hoisted(() => ({
  payload: {
    sub: "applicant-a",
    username: "applicant-a",
    nickname: "Applicant A",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-05-29T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  } as AuthTokenPayload
}));

vi.mock("../services/auth", () => ({
  verifyToken: async (): Promise<AuthTokenPayload> => mockAuthState.payload
}));

const setRouteAuth = (overrides: Partial<AuthTokenPayload> = {}) => {
  mockAuthState.payload = {
    sub: "applicant-a",
    username: "applicant-a",
    nickname: "Applicant A",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-05-29T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000,
    ...overrides
  };
};

beforeEach(() => {
  setRouteAuth();
});

const photoRequiredPolicy: FleetFuelRulePolicy = {
  id: 3,
  policy_name: "现场照片必填",
  policy_type: "photo_required",
  config_json: JSON.stringify({ required: true }),
  severity: "warning",
  enabled: 1
};

describe("fleet governance fuel application rules", () => {
  it("returns amount, card balance, and photo required hits in policy order", () => {
    const policies: FleetFuelRulePolicy[] = [
      {
        id: 1,
        policy_name: "单次额度超过 1000 元",
        policy_type: "amount_limit",
        config_json: JSON.stringify({ max_amount: 1000 }),
        severity: "warning",
        enabled: 1
      },
      {
        id: 2,
        policy_name: "油卡余额低于 300 元",
        policy_type: "card_balance",
        config_json: JSON.stringify({ min_balance: 300 }),
        severity: "high",
        enabled: 1
      },
      photoRequiredPolicy
    ];

    const hits = evaluateFuelApplicationRules({
      policies,
      application: {
        requested_amount: 1200,
        vehicle_mileage_km: 2600,
        photo_keys_json: JSON.stringify([]),
        monthly_apply_count: 1,
        previous_mileage_km: 2400,
        card_latest_balance: 120
      }
    });

    expect(hits).toEqual([
      {
        policy_id: 1,
        policy_type: "amount_limit",
        severity: "warning",
        hit_message: "单次额度超过 1000 元",
        suggested_action: "review"
      },
      {
        policy_id: 2,
        policy_type: "card_balance",
        severity: "high",
        hit_message: "油卡余额低于 300 元",
        suggested_action: "verify_balance"
      },
      {
        policy_id: 3,
        policy_type: "photo_required",
        severity: "warning",
        hit_message: "现场照片必填",
        suggested_action: "request_info"
      }
    ]);
    expect(buildFuelRiskSummary(hits)).toEqual({
      risk_level: "high",
      risk_summary: "命中 3 条规则：单次额度超过 1000 元、油卡余额低于 300 元、现场照片必填"
    });
  });

  it("returns photo required hit when photo array has no non-empty string keys", () => {
    const hits = evaluateFuelApplicationRules({
      policies: [photoRequiredPolicy],
      application: {
        requested_amount: 100,
        vehicle_mileage_km: 2600,
        photo_keys_json: JSON.stringify([null, {}, ""]),
        monthly_apply_count: 1,
        previous_mileage_km: 2400,
        card_latest_balance: 500
      }
    });

    expect(hits).toEqual([
      {
        policy_id: 3,
        policy_type: "photo_required",
        severity: "warning",
        hit_message: "现场照片必填",
        suggested_action: "request_info"
      }
    ]);
  });

  it("does not return photo required hit when photo array has a non-empty string key", () => {
    const hits = evaluateFuelApplicationRules({
      policies: [photoRequiredPolicy],
      application: {
        requested_amount: 100,
        vehicle_mileage_km: 2600,
        photo_keys_json: JSON.stringify(["fuel/photo.jpg"]),
        monthly_apply_count: 1,
        previous_mileage_km: 2400,
        card_latest_balance: 500
      }
    });

    expect(hits).toEqual([]);
  });

  it("returns normal risk summary when no rules are hit", () => {
    expect(buildFuelRiskSummary([])).toEqual({
      risk_level: "normal",
      risk_summary: "未命中风险规则"
    });
  });
});

describe("assertFuelApplicationTransition", () => {
  it("allows pending to move to processed, rejected, needs_info, or cancelled", () => {
    const allowedTargets: FuelApplicationStatus[] = [
      "processed",
      "rejected",
      "needs_info",
      "cancelled"
    ];

    for (const target of allowedTargets) {
      expect(() => assertFuelApplicationTransition("pending", target)).not.toThrow();
    }
  });

  it("allows needs_info to move to pending or cancelled", () => {
    const allowedTargets: FuelApplicationStatus[] = ["pending", "cancelled"];

    for (const target of allowedTargets) {
      expect(() => assertFuelApplicationTransition("needs_info", target)).not.toThrow();
    }
  });

  it("rejects processed to pending with the exact transition message", () => {
    expect(() => assertFuelApplicationTransition("processed", "pending")).toThrow(
      "Invalid fuel application status transition: processed -> pending"
    );
  });

  it("rejects rejected to needs_info with the exact transition message", () => {
    expect(() => assertFuelApplicationTransition("rejected", "needs_info")).toThrow(
      "Invalid fuel application status transition: rejected -> needs_info"
    );
  });
});

describe("appendApiAuditLog", () => {
  it("inserts audit records into api_audit_log from Env with snake_case fields", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-29T03:04:05.006Z"));

      const calls: { sql: string; params: unknown[] }[] = [];
      const env = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...params: unknown[]) => ({
              run: async () => {
                calls.push({ sql, params });
                return { success: true };
              }
            })
          })
        }
      } as unknown as Env;

      await appendApiAuditLog(env, {
        actor_userid: "operator-a",
        actor_roles_json: JSON.stringify(["operator"]),
        action: "fuel_quota_application_reviewed",
        target_type: "fuel_quota_application",
        target_id: "16",
        status: "failed",
        detail_json: JSON.stringify({ reason: "policy hit" })
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("INSERT INTO api_audit_log");
      expect(calls[0]?.params).toEqual([
        "operator-a",
        JSON.stringify(["operator"]),
        "fuel_quota_application_reviewed",
        "fuel_quota_application",
        "16",
        "failed",
        JSON.stringify({ reason: "policy hit" }),
        "2026-05-29T03:04:05.006Z"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fleet governance D1 helpers", () => {
  it("lists enabled fuel rule policies ordered by id", async () => {
    const expectedPolicies: FleetFuelRulePolicy[] = [
      {
        id: 1,
        policy_name: "单次申请额度超过 1000 元",
        policy_type: "amount_limit",
        config_json: JSON.stringify({ max_amount: 1000 }),
        severity: "warning",
        enabled: 1
      }
    ];
    const calls: { sql: string; params: unknown[] }[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            all: async () => {
              calls.push({ sql, params });
              return { results: expectedPolicies };
            }
          })
        })
      }
    } as unknown as Env;

    const policies = await listEnabledFleetFuelRulePolicies(env);

    expect(policies).toEqual(expectedPolicies);
    expect(calls).toEqual([
      {
        sql: expect.stringContaining("FROM fleet_fuel_rule_policy"),
        params: [1]
      }
    ]);
    expect(calls[0]?.sql).toContain("ORDER BY id ASC");
  });

  it("replaces rule hits for an application with one timestamp", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-29T05:06:07.008Z"));

      const calls: { sql: string; params: unknown[] }[] = [];
      const env = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...params: unknown[]) => ({
              run: async () => {
                calls.push({ sql, params });
                return { success: true };
              }
            })
          })
        }
      } as unknown as Env;
      const hits: FuelQuotaRuleHitDraft[] = [
        {
          policy_id: 4,
          policy_type: "card_balance",
          severity: "high",
          hit_message: "油卡余额低于 300 元",
          suggested_action: "verify_balance"
        }
      ];

      await replaceFuelQuotaRuleHits(env, 12, hits);

      expect(calls).toHaveLength(2);
      expect(calls[0]?.sql).toContain("DELETE FROM fuel_quota_rule_hit");
      expect(calls[0]?.params).toEqual([12]);
      expect(calls[1]?.sql).toContain("INSERT INTO fuel_quota_rule_hit");
      expect(calls[1]?.params).toEqual([
        12,
        4,
        "card_balance",
        "high",
        "油卡余额低于 300 元",
        "verify_balance",
        "2026-05-29T05:06:07.008Z"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates pending notification records with retry_count zero", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-29T06:07:08.009Z"));

      const calls: { sql: string; params: unknown[] }[] = [];
      const env = {
        DB: {
          prepare: (sql: string) => ({
            bind: (...params: unknown[]) => ({
              run: async () => {
                calls.push({ sql, params });
                return { success: true };
              }
            })
          })
        }
      } as unknown as Env;

      await createFleetNotificationRecord(env, {
        application_id: 22,
        notification_type: "needs_info",
        target_userids_json: JSON.stringify(["applicant-a"]),
        message_summary: "请补充加油申请资料"
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.sql).toContain("INSERT INTO fleet_wecom_notification");
      expect(calls[0]?.params).toEqual([
        22,
        "needs_info",
        JSON.stringify(["applicant-a"]),
        null,
        "请补充加油申请资料",
        "pending",
        0,
        "2026-05-29T06:07:08.009Z",
        "2026-05-29T06:07:08.009Z"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

class FleetRouteStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FleetRouteDb,
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

type FleetRouteApplicationRow = {
  id: number;
  application_no: string;
  applicant_userid: string;
  vehicle_id: number;
  fuel_card_id: number | null;
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  status: FuelApplicationStatus;
  requested_at: string;
};

class FleetRouteDb {
  readonly runs: { sql: string; params: unknown[] }[] = [];
  readonly alls: { sql: string; params: unknown[] }[] = [];

  constructor(
    private readonly options: {
      application?: Partial<FleetRouteApplicationRow> | null;
      applicationUpdateChanges?: number;
      fuelCard?: { latest_balance?: number; status: string } | null;
      vehicle?: { status: string } | null;
      // 该卡当前有效挂在哪辆车上；默认未绑定
      vehicleBinding?: { vehicle_id: number } | null;
    } = {}
  ) {}

  prepare(sql: string) {
    return new FleetRouteStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (this.options.application === null && sql.includes("FROM fuel_quota_application")) {
      return null;
    }

    if (sql.includes("FROM fuel_quota_application") && sql.includes("WHERE id = ?")) {
      return {
        id: 17,
        application_no: "FQ-260529-001",
        applicant_userid: "applicant-a",
        vehicle_id: 8,
        fuel_card_id: 9,
        requested_amount: 1200,
        vehicle_mileage_km: 34567,
        photo_keys_json: JSON.stringify(["fuel/existing.jpg"]),
        status: "needs_info",
        requested_at: "2026-05-29T01:00:00.000Z",
        ...this.options.application
      } as T;
    }

    if (sql.includes("COUNT(*) AS total")) {
      return { total: 1 } as T;
    }

    if (sql.includes("SELECT vehicle_mileage_km")) {
      return { vehicle_mileage_km: 34000 } as T;
    }

    if (sql.includes("FROM fuel_card_vehicle_binding")) {
      const binding = this.options.vehicleBinding ?? null;
      if (!binding) return null;
      if (sql.includes("vehicle_id = ?") && params[1] !== binding.vehicle_id) return null;
      return { id: 1, vehicle_id: binding.vehicle_id } as T;
    }

    if (sql.includes("FROM company_vehicle WHERE id = ?")) {
      if (this.options.vehicle === null) return null;
      return { id: params[0], status: "active", ...this.options.vehicle } as T;
    }

    if (sql.includes("FROM fuel_card WHERE id = ?")) {
      if (this.options.fuelCard === null) {
        return null;
      }
      return { latest_balance: 500, status: "active", ...this.options.fuelCard } as T;
    }

    if (sql.includes("FROM fleet_fuel_rule_policy WHERE id = ?")) {
      return { id: 1, enabled: 1 } as T;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    this.alls.push({ sql, params });

    if (sql.includes("FROM fleet_fuel_rule_policy")) {
      return {
        results: [
          {
            id: 1,
            policy_name: "单次额度超过 1000 元",
            policy_type: "amount_limit",
            config_json: JSON.stringify({ max_amount: 1000 }),
            severity: "warning",
            enabled: 1
          } as T
        ]
      };
    }

    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    if (sql.includes("UPDATE fuel_quota_application SET")) {
      return {
        meta: {
          last_row_id: this.runs.length,
          changes: this.options.applicationUpdateChanges ?? 1
        }
      };
    }

    return { meta: { last_row_id: this.runs.length, changes: 1 } };
  }
}

class FleetRouteKv {
  async get(): Promise<string> {
    return "session";
  }
}

const createFleetRouteApp = () => {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/fleet", fleetRoutes);
  return app;
};

const createFleetRouteEnv = (db = new FleetRouteDb()) =>
  ({
    DB: db,
    KV: new FleetRouteKv()
  }) as unknown as Env & { DB: FleetRouteDb };

describe("fleet route resubmit", () => {
  it("reuses existing amount, mileage, and photos when resubmit body omits them", async () => {
    const env = createFleetRouteEnv();

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/resubmit",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({})
      },
      env
    );

    expect(response.status).toBe(200);

    const applicationUpdate = env.DB.runs.find((call) =>
      call.sql.includes("UPDATE fuel_quota_application SET")
    );
    expect(applicationUpdate?.sql).toContain("WHERE id = ? AND status = ?");
    expect(applicationUpdate?.params.slice(0, 3)).toEqual([
      1200,
      34567,
      JSON.stringify(["fuel/existing.jpg"])
    ]);

    const ruleHitInsert = env.DB.runs.find((call) =>
      call.sql.includes("INSERT INTO fuel_quota_rule_hit")
    );
    expect(ruleHitInsert?.params).toEqual([
      17,
      1,
      "amount_limit",
      "warning",
      "单次额度超过 1000 元",
      "review",
      expect.any(String)
    ]);

    const auditInsert = env.DB.runs.find((call) => call.sql.includes("INSERT INTO api_audit_log"));
    expect(JSON.parse(String(auditInsert?.params[6]))).toEqual({
      requested_amount: 1200,
      vehicle_mileage_km: 34567,
      photo_keys_json: JSON.stringify(["fuel/existing.jpg"])
    });
  });

  it("returns 409 and skips side effects when resubmit loses the status race", async () => {
    const env = createFleetRouteEnv(new FleetRouteDb({ applicationUpdateChanges: 0 }));

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/resubmit",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({})
      },
      env
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { message: expect.stringContaining("status") }
    });
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO fleet_wecom_notification"))).toBe(
      false
    );
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO fuel_quota_rule_hit"))).toBe(
      false
    );
  });
});

describe("fleet route process", () => {
  it("validates card before processing and writes notification and audit", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(new FleetRouteDb({ application: { status: "pending" } }));

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/process",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ status: "processed", fuel_card_id: 9, latest_card_balance: 800 })
      },
      env
    );

    expect(response.status).toBe(200);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE fuel_card SET"))).toBe(true);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO fleet_wecom_notification"))).toBe(
      true
    );
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(true);
  });

  it("rejects invalid replacement cards before mutating the application", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(
      new FleetRouteDb({ application: { status: "pending" }, fuelCard: null })
    );

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/process",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ status: "processed", fuel_card_id: 99, latest_card_balance: 800 })
      },
      env
    );

    expect(response.status).toBe(400);
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE fuel_quota_application SET"))).toBe(
      false
    );
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE fuel_card SET"))).toBe(false);
  });

  it.each(["needs_info", "processed"] as FuelApplicationStatus[])(
    "rejects %s applications before card balance or event side effects",
    async (status) => {
      setRouteAuth({ sub: "finance-a", roles: ["finance"] });
      const env = createFleetRouteEnv(new FleetRouteDb({ application: { status } }));

      const response = await createFleetRouteApp().request(
        "/fleet/fuel-applications/17/process",
        {
          method: "POST",
          headers: { authorization: "Bearer test-token", "content-type": "application/json" },
          body: JSON.stringify({ status: "processed", latest_card_balance: 800 })
        },
        env
      );

      expect(response.status).toBe(400);
      expect(env.DB.runs.some((call) => call.sql.includes("UPDATE fuel_card SET"))).toBe(false);
      expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO fuel_card_balance_log"))).toBe(
        false
      );
      expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO event_log"))).toBe(false);
    }
  );
});

const getFleet = (path: string, env: Env) =>
  createFleetRouteApp().request(
    path,
    { method: "GET", headers: { authorization: "Bearer test-token" } },
    env
  );

const postFleet = (path: string, body: unknown, env: Env) =>
  createFleetRouteApp().request(
    path,
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );

const findAuditInsert = (db: FleetRouteDb) =>
  db.runs.find((call) => call.sql.includes("INSERT INTO api_audit_log"));

describe("fleet route access scoping", () => {
  it("lets operators list all fuel cards with their bound vehicle", async () => {
    setRouteAuth({ sub: "operator-a", roles: ["operator"] });
    const env = createFleetRouteEnv();

    const response = await getFleet("/fleet/fuel-cards?status=active", env);

    expect(response.status).toBe(200);
    expect(env.DB.alls[0]?.sql).toContain("fuel_card_vehicle_binding");
    expect(env.DB.alls[0]?.sql).not.toContain("bind_userid");
    expect(env.DB.alls[0]?.params).not.toContain("operator-a");
    expect(env.DB.alls[0]?.params).toEqual(["active"]);
  });

  it("ignores legacy mine=true and lists all cards", async () => {
    // finance 账号：旧逻辑下 mine=true 会改成只看本人，两次 SQL 不同
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const plainEnv = createFleetRouteEnv();
    const legacyEnv = createFleetRouteEnv();

    await getFleet("/fleet/fuel-cards?status=active", plainEnv);
    const response = await getFleet("/fleet/fuel-cards?mine=true&status=active", legacyEnv);

    expect(response.status).toBe(200);
    expect(legacyEnv.DB.alls[0]?.sql).toBe(plainEnv.DB.alls[0]?.sql);
    expect(legacyEnv.DB.alls[0]?.params).toEqual(plainEnv.DB.alls[0]?.params);
  });

  it("filters fuel cards by vehicle_id", async () => {
    const env = createFleetRouteEnv();

    const response = await getFleet("/fleet/fuel-cards?status=active&vehicle_id=8", env);

    expect(response.status).toBe(200);
    expect(env.DB.alls[0]?.sql).toContain("vb.vehicle_id = ?");
    expect(env.DB.alls[0]?.params).toEqual(["active", 8]);
  });

  it.each(["abc", "0", "-1"])("rejects invalid vehicle_id filter %s", async (value) => {
    const env = createFleetRouteEnv();

    const response = await getFleet(`/fleet/fuel-cards?vehicle_id=${value}`, env);

    expect(response.status).toBe(400);
    expect(env.DB.alls).toEqual([]);
  });

  it("lists vehicles with their bound fuel card count and numbers", async () => {
    const env = createFleetRouteEnv();

    const response = await getFleet("/fleet/vehicles?status=active", env);

    expect(response.status).toBe(200);
    expect(env.DB.alls[0]?.sql).toContain("fuel_card_count");
    expect(env.DB.alls[0]?.sql).toContain("fuel_card_nos");
    expect(env.DB.alls[0]?.sql).toContain("v.status = ?");
    expect(env.DB.alls[0]?.params).toEqual(["active"]);
  });

  it("forces operators to list only their own fuel applications", async () => {
    setRouteAuth({ sub: "operator-a", roles: ["operator"] });
    const env = createFleetRouteEnv();

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications",
      {
        method: "GET",
        headers: { authorization: "Bearer test-token" }
      },
      env
    );

    expect(response.status).toBe(200);
    expect(env.DB.alls[0]?.sql).toContain("a.applicant_userid = ?");
    expect(env.DB.alls[0]?.params).toContain("operator-a");
  });

  it("rejects operator balance log access", async () => {
    setRouteAuth({ sub: "operator-a", roles: ["operator"] });
    const env = createFleetRouteEnv();

    const response = await getFleet("/fleet/fuel-cards/9/balance-logs", env);

    expect(response.status).toBe(403);
    expect(env.DB.alls).toEqual([]);
  });
});

describe("fleet route fuel card vehicle binding", () => {
  it("binds a card to a vehicle and audits", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await postFleet("/fleet/fuel-cards/9/bind-vehicle", { vehicle_id: 8 }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { outcome: "bound", previous_vehicle_id: null }
    });
    const audit = findAuditInsert(env.DB);
    expect(audit?.params.slice(2, 5)).toEqual(["fuel_card_bind_vehicle", "fuel_card", "9"]);
    expect(JSON.parse(String(audit?.params[6]))).toEqual({
      outcome: "bound",
      from_vehicle_id: null,
      to_vehicle_id: 8
    });
  });

  it("does not audit unchanged bind", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: { vehicle_id: 8 } }));

    const response = await postFleet("/fleet/fuel-cards/9/bind-vehicle", { vehicle_id: 8 }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { outcome: "unchanged" } });
    expect(findAuditInsert(env.DB)).toBeUndefined();
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO fuel_card_vehicle_binding"))).toBe(
      false
    );
  });

  it("rejects bind for operator", async () => {
    setRouteAuth({ sub: "operator-a", roles: ["operator"] });
    const env = createFleetRouteEnv();

    const response = await postFleet("/fleet/fuel-cards/9/bind-vehicle", { vehicle_id: 8 }, env);

    expect(response.status).toBe(403);
    expect(env.DB.runs).toEqual([]);
  });

  it("rejects bind to inactive vehicle", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicle: { status: "inactive" } }));

    const response = await postFleet("/fleet/fuel-cards/9/bind-vehicle", { vehicle_id: 8 }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "所选车辆无效或已停用" } });
    expect(env.DB.runs).toEqual([]);
  });

  it("rejects bind without a positive integer vehicle_id", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await postFleet("/fleet/fuel-cards/9/bind-vehicle", { vehicle_id: "8" }, env);

    expect(response.status).toBe(400);
    expect(env.DB.runs).toEqual([]);
  });

  it("unbinds a bound card and audits", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: { vehicle_id: 8 } }));

    const response = await postFleet("/fleet/fuel-cards/9/unbind-vehicle", {}, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { previous_vehicle_id: 8 } });
    const audit = findAuditInsert(env.DB);
    expect(audit?.params.slice(2, 5)).toEqual(["fuel_card_unbind_vehicle", "fuel_card", "9"]);
    expect(JSON.parse(String(audit?.params[6]))).toEqual({ from_vehicle_id: 8 });
  });

  it("unbind returns 400 when card is not bound", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await postFleet("/fleet/fuel-cards/9/unbind-vehicle", {}, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "该油卡当前未绑定车辆" } });
    expect(findAuditInsert(env.DB)).toBeUndefined();
  });

  it("lists a card's vehicle binding history for finance", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await getFleet("/fleet/fuel-cards/9/vehicle-bindings", env);

    expect(response.status).toBe(200);
    expect(env.DB.alls[0]?.sql).toContain("FROM fuel_card_vehicle_binding b");
    expect(env.DB.alls[0]?.params).toEqual([9]);
  });

  it("bind-user route is gone", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await postFleet("/fleet/fuel-cards/9/bind-user", { bind_userid: "someone" }, env);

    expect(response.status).toBe(404);
    expect(env.DB.runs).toEqual([]);
  });
});

describe("fleet route void", () => {
  it("returns 409 when void loses the status race", async () => {
    setRouteAuth({ sub: "root", roles: ["super_admin"] });
    const env = createFleetRouteEnv(
      new FleetRouteDb({ application: { status: "pending" }, applicationUpdateChanges: 0 })
    );

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/void",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ reason: "duplicate" })
      },
      env
    );

    expect(response.status).toBe(409);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO event_log"))).toBe(false);
    expect(env.DB.runs.some((call) => call.sql.includes("INSERT INTO api_audit_log"))).toBe(false);
  });
});

describe("fleet route rule policy audit", () => {
  it("audits rule policy create, update, and toggle", async () => {
    setRouteAuth({ sub: "root", roles: ["super_admin"] });
    const env = createFleetRouteEnv();
    const app = createFleetRouteApp();

    const createResponse = await app.request(
      "/fleet/rule-policies",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({
          policy_name: "单次额度",
          policy_type: "amount_limit",
          config_json: "{\"max_amount\":1000}",
          severity: "warning",
          enabled: 1
        })
      },
      env
    );
    const updateResponse = await app.request(
      "/fleet/rule-policies/1",
      {
        method: "PUT",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ severity: "high" })
      },
      env
    );
    const toggleResponse = await app.request(
      "/fleet/rule-policies/1/toggle",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-type": "application/json" },
        body: JSON.stringify({ enabled: 0 })
      },
      env
    );

    expect(createResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(toggleResponse.status).toBe(200);
    const auditActions = env.DB.runs
      .filter((call) => call.sql.includes("INSERT INTO api_audit_log"))
      .map((call) => call.params[2]);
    expect(auditActions).toEqual([
      "fleet_fuel_rule_policy_create",
      "fleet_fuel_rule_policy_update",
      "fleet_fuel_rule_policy_toggle"
    ]);
  });
});

describe("fleet route rule hits", () => {
  it("rejects an operator who does not own the application", async () => {
    setRouteAuth({ sub: "applicant-b", roles: ["operator"] });
    const env = createFleetRouteEnv();

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/17/rule-hits",
      {
        method: "GET",
        headers: { authorization: "Bearer test-token" }
      },
      env
    );

    expect(response.status).toBe(403);
    expect(env.DB.runs).toEqual([]);
  });
});

describe("fleet route numeric validation", () => {
  it("returns 400 for an invalid route id", async () => {
    const env = createFleetRouteEnv();

    const response = await createFleetRouteApp().request(
      "/fleet/fuel-applications/not-a-number/rule-hits",
      {
        method: "GET",
        headers: { authorization: "Bearer test-token" }
      },
      env
    );

    expect(response.status).toBe(400);
    expect(env.DB.runs).toEqual([]);
  });

  it("returns 400 for invalid notification pagination", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv();

    const response = await createFleetRouteApp().request(
      "/fleet/notifications?page=0&pageSize=20",
      {
        method: "GET",
        headers: { authorization: "Bearer test-token" }
      },
      env
    );

    expect(response.status).toBe(400);
    expect(env.DB.runs).toEqual([]);
  });
});

describe("fleet route fuel card follows vehicle", () => {
  const applyBody = {
    vehicle_id: 8,
    fuel_card_id: 9,
    requested_amount: 500,
    vehicle_mileage_km: 35000,
    photo_keys_json: JSON.stringify(["a.jpg"])
  };

  const applicationInserted = (db: FleetRouteDb) =>
    db.runs.some((call) => call.sql.includes("INSERT INTO fuel_quota_application"));

  it("submits when the card is bound to the chosen vehicle", async () => {
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: { vehicle_id: 8 } }));

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(201);
    expect(applicationInserted(env.DB)).toBe(true);
  });

  it("submits for an applicant who has no personal binding", async () => {
    setRouteAuth({ sub: "someone-else", roles: ["operator"] });
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: { vehicle_id: 8 } }));

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(201);
    const insert = env.DB.runs.find((call) => call.sql.includes("INSERT INTO fuel_quota_application"));
    expect(insert?.params.slice(1, 4)).toEqual(["someone-else", 8, 9]);
  });

  it("rejects a card bound to another vehicle", async () => {
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: { vehicle_id: 5 } }));

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "该油卡不属于所选车辆" } });
    expect(env.DB.runs).toEqual([]);
  });

  it("rejects an unbound card", async () => {
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: null }));

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "该油卡不属于所选车辆" } });
    expect(env.DB.runs).toEqual([]);
  });

  it("rejects inactive vehicle", async () => {
    const env = createFleetRouteEnv(
      new FleetRouteDb({ vehicle: { status: "inactive" }, vehicleBinding: { vehicle_id: 8 } })
    );

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "所选车辆无效或已停用" } });
    expect(env.DB.runs).toEqual([]);
  });

  it("rejects inactive card", async () => {
    const env = createFleetRouteEnv(
      new FleetRouteDb({ fuelCard: { status: "inactive" }, vehicleBinding: { vehicle_id: 8 } })
    );

    const response = await postFleet("/fleet/fuel-applications", applyBody, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "所选油卡无效或已停用" } });
    expect(env.DB.runs).toEqual([]);
  });

  it("processes legacy application when fuel_card_id equals the current card", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(
      new FleetRouteDb({
        application: { status: "pending", vehicle_id: 8, fuel_card_id: 9 },
        vehicleBinding: null
      })
    );

    const response = await postFleet(
      "/fleet/fuel-applications/17/process",
      { status: "processed", fuel_card_id: 9, latest_card_balance: 800 },
      env
    );

    expect(response.status).toBe(200);
  });

  it("rejects switching to a card of another vehicle", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(
      new FleetRouteDb({
        application: { status: "pending", vehicle_id: 8, fuel_card_id: 9 },
        vehicleBinding: { vehicle_id: 5 }
      })
    );

    const response = await postFleet(
      "/fleet/fuel-applications/17/process",
      { status: "processed", fuel_card_id: 10, latest_card_balance: 800 },
      env
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "该油卡不属于该申请的车辆" } });
    expect(env.DB.runs.some((call) => call.sql.includes("UPDATE fuel_quota_application SET"))).toBe(
      false
    );
  });

  it("allows switching to another card of the same vehicle", async () => {
    setRouteAuth({ sub: "finance-a", roles: ["finance"] });
    const env = createFleetRouteEnv(
      new FleetRouteDb({
        application: { status: "pending", vehicle_id: 8, fuel_card_id: 9 },
        vehicleBinding: { vehicle_id: 8 }
      })
    );

    const response = await postFleet(
      "/fleet/fuel-applications/17/process",
      { status: "processed", fuel_card_id: 10, latest_card_balance: 800 },
      env
    );

    expect(response.status).toBe(200);
  });

  it("resubmits legacy application whose card is not bound to its vehicle", async () => {
    const env = createFleetRouteEnv(new FleetRouteDb({ vehicleBinding: null }));

    const response = await postFleet("/fleet/fuel-applications/17/resubmit", {}, env);

    expect(response.status).toBe(200);
  });
});
