import { queue } from "../../src/queue-handler";
import { createMigratedDatabase, createSqliteD1, normalizeParam } from "./sqlite-d1";

// 报销流程的测试工具。通用的 SQL 夹具在 ./sqlite-d1，这里原样再导出，老测试的导入不用改。
export {
  createMigratedDatabase,
  createSqliteD1,
  hasSqlite,
  listMigrationNames,
  readMigration
} from "./sqlite-d1";

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
  const hooks = { beforeStatement: null };
  const db = createSqliteD1(database, hooks);

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
    /** 在每次数据库往返前调用，用来模拟别的请求这时读到什么。 */
    setStatementHook(fn) {
      hooks.beforeStatement = fn;
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
