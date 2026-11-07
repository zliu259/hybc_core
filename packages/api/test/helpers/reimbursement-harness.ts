import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { queue } from "../../src/queue-handler";

// 报销流程的真实 SQL 测试工具：node:sqlite 跑全部迁移文件，外面包一层 D1 的最小接口。
// CI 是 Node 20，没有 node:sqlite，用到它的测试要 describe.skipIf(!hasSqlite)，推送前必须本地跑。

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = resolve(apiRoot, "migrations");

const sqlite = await import("node:sqlite").catch(() => null);

export const hasSqlite = Boolean(sqlite);

export const readMigration = (name) => readFileSync(resolve(migrationsDir, name), "utf8");

export const listMigrationNames = () =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

const normalizeParam = (value) => {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
};

const returnsRows = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

const executeStatement = (database, sql, params) => {
  const prepared = database.prepare(sql);
  const bound = params.map(normalizeParam);
  if (returnsRows(sql)) {
    return {
      success: true,
      results: prepared.all(...bound).map((row) => ({ ...row })),
      meta: { changes: 0, last_row_id: 0 }
    };
  }
  const info = prepared.run(...bound);
  return {
    success: true,
    results: [],
    meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) }
  };
};

const createStatement = (database, sql, params = []) => ({
  sql,
  params,
  bind: (...next) => createStatement(database, sql, next),
  async first(column) {
    const row = database.prepare(sql).get(...params.map(normalizeParam));
    if (!row) return null;
    return column ? (row[column] ?? null) : { ...row };
  },
  async all() {
    return { success: true, results: database.prepare(sql).all(...params.map(normalizeParam)).map((row) => ({ ...row })), meta: {} };
  },
  async run() {
    return executeStatement(database, sql, params);
  }
});

/** node:sqlite 上的 D1 外壳。和真实 D1 一样，prepare 不校验 SQL，执行时才报错。 */
export const createSqliteD1 = (database) => ({
  prepare: (sql) => createStatement(database, sql),
  async batch(statements) {
    database.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        executeStatement(database, statement.sql, statement.params)
      );
      database.exec("COMMIT");
      return results;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  },
  async exec(sql) {
    database.exec(sql);
    return { count: 1, duration: 0 };
  }
});

export const createMigratedDatabase = (options = {}) => {
  const database = new sqlite.DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  for (const name of listMigrationNames()) {
    if (options.stopBefore && name >= options.stopBefore) break;
    database.exec(readMigration(name));
  }
  return database;
};

const nowIso = () => new Date().toISOString();

const insertRow = (database, table, row) => {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const info = database
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`)
    .run(...columns.map((column) => normalizeParam(row[column])));
  return Number(info.lastInsertRowid);
};

export const createReimbursementHarness = (options = {}) => {
  const database = options.database ?? createMigratedDatabase();
  const db = createSqliteD1(database);

  let sent = [];
  let files = new Map();
  let kv = new Map();
  let sequence = 0;
  let failQueueSend = false;

  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const env = {
    APP_ENV: "local",
    JWT_SECRET: "test-secret",
    DB: db,
    EVENT_QUEUE: {
      async send(event) {
        if (failQueueSend) throw new Error("queue unavailable");
        sent = [...sent, event];
      }
    },
    FILES: {
      async head(key) {
        return files.has(key) ? { key, size: files.get(key) } : null;
      }
    },
    KV: {
      async get(key) {
        return kv.has(key) ? kv.get(key) : null;
      },
      async put(key, value) {
        kv = new Map(kv).set(key, value);
      },
      async delete(key) {
        const next = new Map(kv);
        next.delete(key);
        kv = next;
      }
    }
  };

  return {
    env,
    db: database,
    putFile(key, size) {
      files = new Map(files).set(key, size);
    },
    setQueueSendFailure(value) {
      failQueueSend = value;
    },
    listSentEvents: () => sent,
    /** 把累积的消息交给真实的 queue()，直到队列变空。消费中新发的事件也会被处理。 */
    async drainQueue() {
      let acked = 0;
      let retried = 0;
      for (let pass = 0; pass < 10 && sent.length > 0; pass += 1) {
        const messages = sent.map((body) => ({
          body,
          ack() {
            acked += 1;
          },
          retry() {
            retried += 1;
          }
        }));
        sent = [];
        await queue({ messages }, env);
      }
      return { acked, retried };
    },
    async seedEnvelope(fields = {}) {
      const n = nextSequence();
      const now = nowIso();
      return insertRow(database, "reimbursement_envelope", {
        envelope_no: `RM-TEST-${n}`,
        envelope_uuid: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        project_id: 1,
        applicant_userid: "u1",
        channel: "electronic",
        amount: 0,
        status: "draft",
        created_at: now,
        updated_at: now,
        ...fields
      });
    },
    async seedAttachment(envelopeId, fields = {}) {
      const n = nextSequence();
      return insertRow(database, "envelope_attachment", {
        envelope_id: envelopeId,
        attachment_type: "invoice",
        file_key: `reimbursement/test/${n}.pdf`,
        file_name: `${n}.pdf`,
        status: "active",
        created_at: nowIso(),
        ...fields
      });
    },
    /** 只改任务行，不发 TASK_COMPLETED，测试需要时自己发。output 按 runner 的格式包成字符串。 */
    async finishTask(taskId, status, output) {
      const resultJson = output === undefined ? null : JSON.stringify({ output: JSON.stringify(output) });
      database
        .prepare("UPDATE task_queue SET status = ?, result_json = ?, updated_at = ? WHERE id = ?")
        .run(status, resultJson, nowIso(), taskId);
    },
    listTasks: (taskType) =>
      database
        .prepare(
          taskType
            ? "SELECT * FROM task_queue WHERE task_type = ? ORDER BY id"
            : "SELECT * FROM task_queue ORDER BY id"
        )
        .all(...(taskType ? [taskType] : []))
        .map((row) => ({ ...row })),
    listReviews: (envelopeId) =>
      database
        .prepare("SELECT * FROM reimbursement_invoice_review WHERE envelope_id = ? ORDER BY id")
        .all(envelopeId)
        .map((row) => ({ ...row })),
    getEnvelope: (envelopeId) => {
      const row = database.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?").get(envelopeId);
      return row ? { ...row } : null;
    }
  };
};
