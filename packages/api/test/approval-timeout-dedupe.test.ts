import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queue } from "../src/queue-handler";
import { checkApprovalTimeouts } from "../src/services/approval/engine";

// 背景（2026-11-06）：event_log 的 APPROVAL_TIMEOUT 涨到约 49.7 万行，最近 24 小时 3,558 行，
// 而且没有任何消费方。两层原因：
//  1. 每次整点巡检都为每个超时节点发一次事件，节点不结束就一直发；
//  2. publishEvent 自己写一行，队列消费者 queue() 拿到同一事件又写一行，所以每小时每节点 2 行。
// 这里的用例把消息真的喂给 queue()，第 2 层才不会被漏掉。
//
// 两种后端跑同一组场景：
//  - 内存假 D1：CI 是 Node 20，没有 node:sqlite，靠它守住去重行为；
//  - 真实 SQLite + 真实迁移文件：Node >= 22.5 才有，能证明 SQL 和 0091 迁移本身是对的。
// 放在 test/ 而不是 src/ 的原因见 wrangler-prod-env.test.ts 的头部注释。

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readMigration = (name) => readFileSync(resolve(apiRoot, "migrations", name), "utf8");

const sqlite = await import("node:sqlite").catch(() => null);

const INSTANCE_ID = 10;
const hoursBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

/** 把累积的队列消息交给真实消费者，和线上一样由 queue() 决定要不要再写一行。 */
const createQueueDrain = (getEnv) => {
  let sent = [];
  return {
    async send(event) {
      sent = [...sent, event];
    },
    async drain() {
      const messages = sent.map((body) => ({ body, ack() {}, retry() {} }));
      sent = [];
      await queue({ messages }, getEnv());
    }
  };
};

const createFakeHarness = () => {
  let nodes = new Map();
  let events = [];
  let failNextInsert = false;

  const notRecordedYet = (node) =>
    node.timeout_event_at === null || node.timeout_event_at < node.started_at;

  const changes = (count) => ({ meta: { changes: count } });

  const runStatement = (sql, params) => {
    if (/INSERT INTO event_log/.test(sql)) {
      if (failNextInsert) {
        failNextInsert = false;
        throw new Error("D1 write failed");
      }
      const [event_type, event_source, event_payload] = params;
      events = [...events, { event_type, event_source, event_payload }];
      return changes(1);
    }
    if (/SET timeout_event_at = NULL/.test(sql)) {
      const [id] = params;
      nodes = new Map(nodes).set(id, { ...nodes.get(id), timeout_event_at: null });
      return changes(1);
    }
    if (/SET timeout_event_at = \?/.test(sql)) {
      const [at, id] = params;
      const node = nodes.get(id);
      if (!node || !notRecordedYet(node)) return changes(0);
      nodes = new Map(nodes).set(id, { ...node, timeout_event_at: at });
      return changes(1);
    }
    throw new Error(`假 D1 没见过这条 SQL: ${sql}`);
  };

  const db = {
    prepare(sql) {
      const statement = (params) => ({
        bind: (...next) => statement(next),
        async all() {
          const [now] = params;
          const results = [...nodes.values()].filter(
            (node) =>
              node.status === "in_progress" &&
              hoursBetween(node.started_at, now) > (node.timeout_hours ?? 24) &&
              notRecordedYet(node)
          );
          return { results };
        },
        async run() {
          return runStatement(sql, params);
        }
      });
      return statement([]);
    }
  };

  const queueDrain = createQueueDrain(() => env);
  const env = { DB: db, EVENT_QUEUE: { send: queueDrain.send } };

  return {
    env,
    drainQueue: queueDrain.drain,
    seedNode(seed) {
      nodes = new Map(nodes).set(seed.id, {
        instance_id: INSTANCE_ID,
        node_key: "finance_review",
        node_type: "sequential",
        status: "in_progress",
        timeout_hours: null,
        timeout_event_at: null,
        ...seed
      });
    },
    reenterNode(id, startedAt) {
      nodes = new Map(nodes).set(id, { ...nodes.get(id), started_at: startedAt });
    },
    failNextEventInsert() {
      failNextInsert = true;
    },
    timeoutEvents: () => events.filter((event) => event.event_type === "APPROVAL_TIMEOUT")
  };
};

/** node:sqlite 上的最小 D1 外壳，只实现被测代码用到的方法。 */
const createSqliteD1 = (database, shouldFailInsert) => ({
  prepare(sql) {
    const statement = (params) => ({
      bind: (...next) => statement(next),
      async all() {
        return { results: database.prepare(sql).all(...params) };
      },
      async run() {
        if (/INSERT INTO event_log/.test(sql) && shouldFailInsert()) {
          throw new Error("D1 write failed");
        }
        const info = database.prepare(sql).run(...params);
        return { meta: { changes: Number(info.changes) } };
      }
    });
    return statement([]);
  }
});

const insertNode = (database, seed) => {
  database
    .prepare(
      `INSERT INTO approval_node_instance
         (id, instance_id, node_key, node_type, node_name, status, round, started_at, timeout_hours,
          created_at, updated_at)
       VALUES (?, ?, 'finance_review', 'sequential', '财务审核', ?, 1, ?, ?, ?, ?)`
    )
    .run(
      seed.id,
      seed.instance_id ?? INSTANCE_ID,
      seed.status ?? "in_progress",
      seed.started_at,
      seed.timeout_hours ?? null,
      seed.started_at,
      seed.started_at
    );
};

/** 建到 0091 之前的库：event_log、审批表和 timeout_hours。 */
const createBaseDatabase = () => {
  const database = new sqlite.DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  database.exec(readMigration("0001_init.sql"));
  database.exec(readMigration("0005_approval.sql"));
  database.exec(readMigration("0012_phase3_instance_config_timeout.sql"));
  database
    .prepare(
      `INSERT INTO approval_instance
         (id, instance_no, template_id, biz_type, biz_id, biz_summary, initiator_userid, status,
          current_round, submitted_at, created_at, updated_at)
       VALUES (?, 'SP-20261105-0001', 1, 'payment_request', 1, '付款', 'u1', 'in_progress', 1, ?, ?, ?)`
    )
    .run(
      INSTANCE_ID,
      "2026-11-05T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z",
      "2026-11-05T00:00:00.000Z"
    );
  return database;
};

const createSqliteHarness = (database = null) => {
  const db = database ?? createBaseDatabase();
  if (!database) db.exec(readMigration("0091_approval_node_timeout_event_at.sql"));

  let failNextInsert = false;
  const shouldFailInsert = () => {
    const fail = failNextInsert;
    failNextInsert = false;
    return fail;
  };

  const queueDrain = createQueueDrain(() => env);
  const env = {
    DB: createSqliteD1(db, shouldFailInsert),
    EVENT_QUEUE: { send: queueDrain.send }
  };

  return {
    env,
    drainQueue: queueDrain.drain,
    seedNode: (seed) => insertNode(db, seed),
    reenterNode(id, startedAt) {
      db.prepare("UPDATE approval_node_instance SET started_at = ? WHERE id = ?").run(startedAt, id);
    },
    failNextEventInsert() {
      failNextInsert = true;
    },
    timeoutEvents: () =>
      db
        .prepare(
          "SELECT event_type, event_source, event_payload FROM event_log WHERE event_type = 'APPROVAL_TIMEOUT'"
        )
        .all()
  };
};

/** 在指定时刻跑一次整点巡检，并把这次产生的队列消息全部消费完。 */
const patrolAt = async (harness, at) => {
  vi.setSystemTime(new Date(at));
  const recorded = await checkApprovalTimeouts(harness.env);
  await harness.drainQueue();
  return recorded;
};

const backends = [
  ["内存假 D1", createFakeHarness],
  ...(sqlite ? [["真实 SQLite + 迁移文件", createSqliteHarness]] : [])
];

describe("checkApprovalTimeouts 每个节点只记一次", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe.each(backends)("%s", (_name, createHarness) => {
    it("同一节点连续三次整点巡检，经过队列消费者后也只留一行", async () => {
      const harness = createHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z" });

      const recorded = [
        await patrolAt(harness, "2026-11-06T02:00:00.000Z"),
        await patrolAt(harness, "2026-11-06T03:00:00.000Z"),
        await patrolAt(harness, "2026-11-06T04:00:00.000Z")
      ];

      expect(recorded).toEqual([1, 0, 0]);
      const events = harness.timeoutEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event_source).toBe("approval-engine");
      expect(JSON.parse(events[0].event_payload)).toEqual({
        instance_id: INSTANCE_ID,
        node_key: "finance_review",
        node_type: "sequential",
        started_at: "2026-11-05T00:00:00.000Z"
      });
    });

    it("两个节点各记各的，互不影响", async () => {
      const harness = createHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z" });
      harness.seedNode({ id: 2, started_at: "2026-11-05T00:30:00.000Z" });

      await patrolAt(harness, "2026-11-06T02:00:00.000Z");
      await patrolAt(harness, "2026-11-06T03:00:00.000Z");

      expect(harness.timeoutEvents()).toHaveLength(2);
    });

    it("退回后重新进入同一节点，再次超时时再记一行", async () => {
      const harness = createHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z" });
      await patrolAt(harness, "2026-11-06T02:00:00.000Z");

      // engine.ts 的退回把同一行重置为 in_progress，并写入新的 started_at。
      harness.reenterNode(1, "2026-11-06T05:00:00.000Z");
      await patrolAt(harness, "2026-11-06T06:00:00.000Z");
      expect(harness.timeoutEvents()).toHaveLength(1);

      await patrolAt(harness, "2026-11-07T06:00:00.000Z");
      await patrolAt(harness, "2026-11-07T07:00:00.000Z");

      const events = harness.timeoutEvents();
      expect(events).toHaveLength(2);
      expect(JSON.parse(events[1].event_payload).started_at).toBe("2026-11-06T05:00:00.000Z");
    });

    it("写事件失败时释放占位，下一次巡检补记，不丢也不重复", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const harness = createHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z" });

      harness.failNextEventInsert();
      await expect(patrolAt(harness, "2026-11-06T02:00:00.000Z")).resolves.toBe(0);
      expect(harness.timeoutEvents()).toHaveLength(0);
      expect(console.error).toHaveBeenCalled();

      await patrolAt(harness, "2026-11-06T03:00:00.000Z");
      await patrolAt(harness, "2026-11-06T04:00:00.000Z");
      expect(harness.timeoutEvents()).toHaveLength(1);
    });
  });

  it("查询失败不抛错，不拖垮同批的其它 cron 任务", async () => {
    // 代码先于 0091 迁移上线时就是这种报错；小时批次用 Promise.all，一抛后面的车辆超时通知就跑不到了。
    const failure = new Error("no such column: timeout_event_at");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: {
        prepare() {
          throw failure;
        }
      }
    };

    await expect(checkApprovalTimeouts(env)).resolves.toBe(0);
    expect(consoleError).toHaveBeenCalledWith("Approval timeout check failed", failure);
  });

  describe.skipIf(!sqlite)("只有真实 SQL 能证明的部分", () => {
    it("默认 24 小时才算超时，节点自定义时限优先", async () => {
      const harness = createSqliteHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z" });
      harness.seedNode({ id: 2, started_at: "2026-11-05T00:00:00.000Z", timeout_hours: 48 });
      harness.seedNode({ id: 3, started_at: "2026-11-05T00:00:00.000Z", timeout_hours: 4 });

      await expect(patrolAt(harness, "2026-11-05T03:00:00.000Z")).resolves.toBe(0);
      await expect(patrolAt(harness, "2026-11-05T05:00:00.000Z")).resolves.toBe(1);
      await expect(patrolAt(harness, "2026-11-06T01:00:00.000Z")).resolves.toBe(1);
      await expect(patrolAt(harness, "2026-11-07T00:30:00.000Z")).resolves.toBe(1);
    });

    it("已经办完的节点不记", async () => {
      const harness = createSqliteHarness();
      harness.seedNode({ id: 1, started_at: "2026-11-05T00:00:00.000Z", status: "completed" });

      await patrolAt(harness, "2026-11-06T02:00:00.000Z");

      expect(harness.timeoutEvents()).toHaveLength(0);
    });

    it("0091 回填：迁移时已超时的节点不再补记，迁移后才超时的照常记一次", async () => {
      const database = createBaseDatabase();
      insertNode(database, { id: 1, started_at: "2020-01-01T00:00:00.000Z" });
      insertNode(database, { id: 2, started_at: "2020-01-01T00:00:00.000Z", status: "completed" });
      database.exec(readMigration("0091_approval_node_timeout_event_at.sql"));

      const stamped = database
        .prepare("SELECT id, timeout_event_at FROM approval_node_instance ORDER BY id")
        .all();
      expect(stamped[0].timeout_event_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(stamped[1].timeout_event_at).toBeNull();

      const harness = createSqliteHarness(database);
      const realNow = new Date().toISOString();
      const startedAt = new Date(Date.parse(realNow) - 25 * 3_600_000).toISOString();
      insertNode(database, { id: 3, started_at: startedAt });

      await patrolAt(harness, realNow);
      await patrolAt(harness, new Date(Date.parse(realNow) + 3_600_000).toISOString());

      const events = harness.timeoutEvents();
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0].event_payload).started_at).toBe(startedAt);
    });
  });
});
