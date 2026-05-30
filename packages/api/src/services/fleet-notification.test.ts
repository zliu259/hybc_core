import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFleetNotificationCard,
  createFleetTimeoutNotifications,
  deliverPendingFleetNotifications,
  resolveFleetNotificationTitle
} from "./fleet-notification";
import type { Env } from "../types/env";

const weComPushMock = vi.hoisted(() => ({
  sendWeComTemplateCard: vi.fn()
}));

vi.mock("./wecom-approval-push", () => ({
  sendWeComTemplateCard: weComPushMock.sendWeComTemplateCard
}));

beforeEach(() => {
  weComPushMock.sendWeComTemplateCard.mockReset();
  weComPushMock.sendWeComTemplateCard.mockResolvedValue({
    msgid: "msg-1",
    invaliduser: null,
    unlicenseduser: null
  });
});

describe("fleet notification cards", () => {
  it("resolves the submitted notification title", () => {
    expect(resolveFleetNotificationTitle("submitted")).toBe("油卡申请待处理");
  });

  it("builds a submitted text_notice with title, amount emphasis, and one jump item", () => {
    const card = buildFleetNotificationCard({
      notification_type: "submitted",
      application_no: "FQ-260529-001",
      applicant_name: "applicant-a",
      amount_text: "1,200.00",
      risk_summary: "命中 1 条规则：单次额度超过 1000 元",
      detail_url: "https://example.com/finance/fleet/processing?application_id=17"
    });

    expect(card).toMatchObject({
      card_type: "text_notice",
      source: {
        desc: "车辆油卡"
      },
      main_title: {
        title: "油卡申请待处理",
        desc: expect.stringContaining("FQ-260529-001")
      },
      emphasis_content: {
        title: "1,200.00",
        desc: "申请额度"
      },
      jump_list: [
        {
          type: 1,
          title: "打开Web处理",
          url: "https://example.com/finance/fleet/processing?application_id=17"
        }
      ],
      card_action: {
        type: 1,
        url: "https://example.com/finance/fleet/processing?application_id=17"
      }
    });
  });
});

class FleetNotificationStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FleetNotificationDb,
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

class FleetNotificationDb {
  readonly runs: { sql: string; params: unknown[] }[] = [];

  constructor(
    private readonly pendingNotifications: unknown[] = [],
    private readonly timeoutApplications: unknown[] = [],
    private readonly applicationRows = new Map<number, unknown>(),
    private readonly claimChanges = 1
  ) {}

  prepare(sql: string) {
    return new FleetNotificationStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM fuel_quota_application") && sql.includes("WHERE id = ?")) {
      return (this.applicationRows.get(Number(params[0])) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM fuel_quota_application") && sql.includes("notification_type = 'timeout'")) {
      return { results: this.timeoutApplications as T[] };
    }

    if (sql.includes("FROM fleet_wecom_notification") && sql.includes("status = 'pending'")) {
      if (sql.includes("AND id = ?")) {
        const targetId = Number(params[1]);
        return {
          results: this.pendingNotifications.filter(
            (item) => (item as { id?: number }).id === targetId
          ) as T[]
        };
      }

      return { results: this.pendingNotifications as T[] };
    }

    return { results: [] };
  }

  async run(sql: string, params: unknown[]) {
    this.runs.push({ sql, params });
    const changes = sql.includes("status = 'sending'") ? this.claimChanges : 1;
    return { meta: { last_row_id: this.runs.length, changes } };
  }
}

class FleetNotificationKv {
  constructor(private readonly values = new Map<string, string | null>()) {}

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

const createFleetNotificationEnv = (
  db: FleetNotificationDb,
  kv = new FleetNotificationKv()
) =>
  ({
    DB: db,
    KV: kv
  }) as unknown as Env;

describe("fleet notification delivery", () => {
  it("skips pending notifications when no target users resolve", async () => {
    const db = new FleetNotificationDb([
      {
        id: 12,
        application_id: 17,
        notification_type: "submitted",
        target_userids_json: null,
        target_group_key: "finance_office",
        message_summary: "待处理"
      }
    ]);

    const result = await deliverPendingFleetNotifications(createFleetNotificationEnv(db));

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    const skippedUpdate = db.runs.find((call) => call.params[0] === "skipped");
    expect(skippedUpdate?.sql).toContain("UPDATE fleet_wecom_notification");
    expect(skippedUpdate?.params.slice(0, 4)).toEqual([
      "skipped",
      "No target users resolved",
      0,
      null
    ]);
  });

  it("delivers only the requested notification id when notificationId is provided", async () => {
    const db = new FleetNotificationDb(
      [
        {
          id: 11,
          application_id: 16,
          notification_type: "submitted",
          target_userids_json: JSON.stringify(["older-user"]),
          target_group_key: null,
          message_summary: "older"
        },
        {
          id: 12,
          application_id: 17,
          notification_type: "submitted",
          target_userids_json: JSON.stringify(["target-user"]),
          target_group_key: null,
          message_summary: "target"
        }
      ],
      [],
      new Map([
        [
          17,
          {
            id: 17,
            application_no: "FQ-260529-001",
            applicant_userid: "applicant-a",
            requested_amount: 1200,
            risk_summary: "待处理"
          }
        ]
      ])
    );

    const result = await deliverPendingFleetNotifications(createFleetNotificationEnv(db), {
      notificationId: 12
    });

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(weComPushMock.sendWeComTemplateCard).toHaveBeenCalledTimes(1);
    expect(weComPushMock.sendWeComTemplateCard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ touser: "target-user" })
    );
    expect(db.runs.some((call) => call.params.includes(11))).toBe(false);
  });

  it("marks notification delivery failed when WeCom reports rejected recipients", async () => {
    weComPushMock.sendWeComTemplateCard.mockResolvedValueOnce({
      msgid: "msg-1",
      invaliduser: "bad-user",
      unlicenseduser: null
    });
    const db = new FleetNotificationDb(
      [
        {
          id: 12,
          application_id: 17,
          notification_type: "submitted",
          target_userids_json: JSON.stringify(["bad-user"]),
          target_group_key: null,
          message_summary: "target"
        }
      ],
      [],
      new Map([
        [
          17,
          {
            id: 17,
            application_no: "FQ-260529-001",
            applicant_userid: "applicant-a",
            requested_amount: 1200,
            risk_summary: "待处理"
          }
        ]
      ])
    );

    const result = await deliverPendingFleetNotifications(createFleetNotificationEnv(db), {
      notificationId: 12
    });

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    const failedUpdate = db.runs.find((call) => call.params[0] === "failed");
    expect(failedUpdate?.params[1]).toContain("invaliduser=bad-user");
    expect(failedUpdate?.params[2]).toBe(1);
    expect(failedUpdate?.params[3]).toBeNull();
  });

  it("creates timeout notifications for stale pending applications", async () => {
    const db = new FleetNotificationDb([], [
      {
        id: 17,
        application_no: "FQ-260529-001"
      }
    ]);

    const created = await createFleetTimeoutNotifications(createFleetNotificationEnv(db));

    expect(created).toBe(1);
    const insert = db.runs.find((call) => call.sql.includes("INSERT INTO fleet_wecom_notification"));
    expect(insert?.params.slice(0, 4)).toEqual([
      17,
      "timeout",
      null,
      "finance_office"
    ]);
    expect(insert?.params[4]).toBe("油卡申请 FQ-260529-001 已超过 4 小时未处理");
  });
});
