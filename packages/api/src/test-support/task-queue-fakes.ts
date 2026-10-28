import type { TaskQueueItem } from "../types/ai";

/**
 * 面向 task_queue 的最小 D1 假实现。
 *
 * 只解释 task-queue / ai-slot 对 task_queue 实际发出的几种语句形态（按 id 取行、
 * 按 biz 过滤、pollForNode 的子查询抢占、带 status 守卫的 UPDATE），并把 SQL 里
 * 的字面量 `status IN (...)`、`status = 'x'`、`col = ?` 真正当作行匹配条件执行——
 * 这样测试断言的是生产 SQL 的语义，而不是假实现自己的硬编码。
 *
 * 不碰 task_queue 的语句交给 fallback；没有 fallback 时 first/all 返回空、run 记 1 行。
 */

export type FakeTaskSeed = Pick<TaskQueueItem, "id" | "task_type" | "biz_type" | "biz_id"> &
  Partial<TaskQueueItem>;

export interface SqlCall {
  kind: "first" | "all" | "run";
  sql: string;
  params: unknown[];
}

export interface FakeD1Fallback {
  first?: (sql: string, params: unknown[]) => unknown;
  all?: (sql: string, params: unknown[]) => unknown[];
  /** 返回受影响行数 */
  run?: (sql: string, params: unknown[]) => number;
}

type RunMeta = { meta: { changes: number; last_row_id: number } };

const DEFAULT_CREATED_AT = "2026-10-27T01:00:00.000Z";

const defaultRow = (seed: FakeTaskSeed): TaskQueueItem => ({
  task_code: `TK-${seed.id}`,
  priority: 5,
  payload_json: "{}",
  provider_id: null,
  assigned_node_id: null,
  status: "pending",
  max_retries: 3,
  retry_count: 0,
  timeout_seconds: 300,
  result_json: null,
  error_message: null,
  assigned_at: null,
  started_at: null,
  completed_at: null,
  created_at: DEFAULT_CREATED_AT,
  updated_at: DEFAULT_CREATED_AT,
  ...seed
});

const normalize = (sql: string): string => sql.replace(/\s+/g, " ").trim();

const splitStatement = (
  text: string
): { body: string; where: string; orderBy: string; limit: number | null } => {
  let rest = text;
  let limit: number | null = null;
  const limitMatch = rest.match(/ LIMIT (\d+)$/i);
  if (limitMatch) {
    limit = Number(limitMatch[1]);
    rest = rest.slice(0, rest.length - limitMatch[0].length);
  }
  let orderBy = "";
  const orderIdx = rest.search(/ ORDER BY /i);
  if (orderIdx >= 0) {
    orderBy = rest.slice(orderIdx + " ORDER BY ".length);
    rest = rest.slice(0, orderIdx);
  }
  let where = "";
  const whereIdx = rest.search(/ WHERE /i);
  if (whereIdx >= 0) {
    where = rest.slice(whereIdx + " WHERE ".length);
    rest = rest.slice(0, whereIdx);
  }
  return { body: rest, where, orderBy, limit };
};

const parseLiteralList = (raw: string): string[] =>
  raw
    .split(",")
    .map((item) => item.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);

type RowPredicate = (row: TaskQueueItem) => boolean;

const LIVE_CLAUSE =
  /\(\s*status IN \(([^)]*)\) OR \(\s*status = 'timeout' AND retry_count < max_retries\s*\)\s*\)/i;
const STATUS_IN = /\bstatus IN \(([^)]*)\)/i;
const EQ_PARAM = /\b(\w+) = \?/g;
const EQ_LITERAL = /\b(\w+) = '([^']*)'/g;

const rowValue = (row: TaskQueueItem, column: string): unknown =>
  (row as unknown as Record<string, unknown>)[column];

/**
 * 把 WHERE 子句翻译成行谓词。支持：`col = ?`（按出现顺序消费 params）、`col = 'lit'`、
 * `status IN (...)`，以及撤回逻辑用的「活任务」复合条件。不认识的片段会被忽略——
 * 因此测试里必须同时放「该被改」与「不该被改」的行，才能证明谓词真的生效。
 */
const buildPredicate = (where: string, params: unknown[]): RowPredicate => {
  const preds: RowPredicate[] = [];
  let clause = where;

  const live = clause.match(LIVE_CLAUSE);
  if (live) {
    const statuses = parseLiteralList(live[1]);
    preds.push(
      (row) =>
        statuses.includes(row.status) ||
        (row.status === "timeout" && row.retry_count < row.max_retries)
    );
    clause = clause.replace(LIVE_CLAUSE, "1=1");
  } else {
    const inList = clause.match(STATUS_IN);
    if (inList) {
      const statuses = parseLiteralList(inList[1]);
      preds.push((row) => statuses.includes(row.status));
      clause = clause.replace(STATUS_IN, "1=1");
    }
  }

  for (const match of clause.matchAll(EQ_LITERAL)) {
    const [, column, literal] = match;
    preds.push((row) => String(rowValue(row, column)) === literal);
  }

  let paramIdx = 0;
  for (const match of clause.matchAll(EQ_PARAM)) {
    const column = match[1];
    const expected = params[paramIdx++];
    preds.push((row) => rowValue(row, column) === expected);
  }

  return (row) => preds.every((pred) => pred(row));
};

const compareValues = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
};

const sortRows = (rows: TaskQueueItem[], orderBy: string): TaskQueueItem[] => {
  if (!orderBy) return [...rows];
  const keys = orderBy.split(",").map((part) => {
    const [column, direction] = part.trim().split(/\s+/);
    return { column, desc: (direction ?? "ASC").toUpperCase() === "DESC" };
  });
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const cmp = compareValues(rowValue(a, key.column), rowValue(b, key.column));
      if (cmp !== 0) return key.desc ? -cmp : cmp;
    }
    return 0;
  });
};

type Assignment = (row: TaskQueueItem) => Partial<TaskQueueItem>;

const parseAssignments = (
  setClause: string,
  params: unknown[]
): { assignments: Assignment[]; consumed: number } => {
  const assignments: Assignment[] = [];
  let consumed = 0;
  for (const part of setClause.split(", ")) {
    const match = part.match(/^(\w+) = (.+)$/);
    if (!match) continue;
    const [, column, expr] = match;
    if (expr === "?") {
      const value = params[consumed++];
      assignments.push(() => ({ [column]: value }));
    } else if (/^NULL$/i.test(expr)) {
      assignments.push(() => ({ [column]: null }));
    } else if (/^'.*'$/.test(expr)) {
      assignments.push(() => ({ [column]: expr.slice(1, -1) }));
    } else {
      const increment = expr.match(/^(\w+) \+ (\d+)$/);
      if (increment) {
        const [, source, amount] = increment;
        assignments.push((row) => ({
          [column]: Number(rowValue(row, source)) + Number(amount)
        }));
      }
    }
  }
  return { assignments, consumed };
};

const applyAssignments = (row: TaskQueueItem, assignments: Assignment[]): TaskQueueItem =>
  assignments.reduce<TaskQueueItem>((acc, assign) => ({ ...acc, ...assign(acc) }), row);

export class FakeTaskQueue {
  private rows = new Map<number, TaskQueueItem>();
  readonly calls: SqlCall[] = [];

  seed(...tasks: FakeTaskSeed[]): void {
    for (const seed of tasks) {
      this.rows.set(seed.id, defaultRow(seed));
    }
  }

  get(id: number): TaskQueueItem {
    const row = this.rows.get(id);
    if (!row) throw new Error(`fake task_queue has no row ${id}`);
    return row;
  }

  list(): TaskQueueItem[] {
    return [...this.rows.values()];
  }

  /** 记录过的、真正改到 task_queue 行的 UPDATE 语句 */
  get taskQueueUpdates(): SqlCall[] {
    return this.calls.filter(
      (call) => call.kind === "run" && /^UPDATE task_queue\b/i.test(normalize(call.sql))
    );
  }

  private select(sql: string, params: unknown[]): TaskQueueItem[] {
    const { where, orderBy, limit } = splitStatement(normalize(sql));
    const predicate = where ? buildPredicate(where, params) : () => true;
    const matched = sortRows(this.list().filter(predicate), orderBy);
    return limit === null ? matched : matched.slice(0, limit);
  }

  private claimForNode(setClause: string, params: unknown[], where: string): number {
    const { assignments, consumed } = parseAssignments(setClause, params);
    const capabilities = params.slice(consumed) as string[];
    const inner = where.match(/\(\s*SELECT id FROM task_queue WHERE (.+?)(?: ORDER BY (.+?))? LIMIT 1\s*\)/i);
    if (!inner) throw new Error(`fake task_queue cannot parse claim subquery: ${where}`);
    const [, innerWhere, innerOrder] = inner;
    const statusLiteral = innerWhere.match(/status = '(\w+)'/i);
    const candidates = this.list().filter(
      (row) =>
        (!statusLiteral || row.status === statusLiteral[1]) &&
        (!/task_type IN/i.test(innerWhere) || capabilities.includes(row.task_type))
    );
    const winner = sortRows(candidates, innerOrder ?? "")[0];
    if (!winner) return 0;
    this.rows.set(winner.id, applyAssignments(winner, assignments));
    return 1;
  }

  private update(sql: string, params: unknown[]): number {
    const text = normalize(sql);
    const match = text.match(/^UPDATE task_queue SET (.+?) WHERE (.+)$/i);
    if (!match) throw new Error(`fake task_queue cannot parse UPDATE: ${text}`);
    const [, setClause, where] = match;
    if (/^id = \(\s*SELECT/i.test(where)) {
      return this.claimForNode(setClause, params, where);
    }
    const { assignments, consumed } = parseAssignments(setClause, params);
    const predicate = buildPredicate(where, params.slice(consumed));
    let changes = 0;
    for (const row of this.list()) {
      if (!predicate(row)) continue;
      this.rows.set(row.id, applyAssignments(row, assignments));
      changes += 1;
    }
    return changes;
  }

  private touchesTaskQueue(sql: string): boolean {
    return /\btask_queue\b/i.test(sql) && !/\bJOIN\b/i.test(sql);
  }

  /** 节点领任务时顺带查的三张配置表，统一回空 */
  private isEmptyConfigTable(sql: string): boolean {
    return /\b(ai_provider_config|ai_routing_rule|runner_runtime_config)\b/i.test(sql);
  }

  first(sql: string, params: unknown[]): { handled: boolean; value: unknown } {
    this.calls.push({ kind: "first", sql, params });
    if (this.isEmptyConfigTable(sql)) return { handled: true, value: null };
    if (!this.touchesTaskQueue(sql)) return { handled: false, value: null };
    const text = normalize(sql);
    if (/^SELECT COUNT\(\*\)/i.test(text)) {
      return { handled: true, value: { total: this.select(sql, params).length } };
    }
    return { handled: true, value: this.select(sql, params)[0] ?? null };
  }

  all(sql: string, params: unknown[]): { handled: boolean; value: unknown[] } {
    this.calls.push({ kind: "all", sql, params });
    if (this.isEmptyConfigTable(sql)) return { handled: true, value: [] };
    if (!this.touchesTaskQueue(sql)) return { handled: false, value: [] };
    return { handled: true, value: this.select(sql, params) };
  }

  run(sql: string, params: unknown[]): { handled: boolean; changes: number } {
    this.calls.push({ kind: "run", sql, params });
    if (!this.touchesTaskQueue(sql)) return { handled: false, changes: 0 };
    const text = normalize(sql);
    if (/^UPDATE task_queue\b/i.test(text)) {
      return { handled: true, changes: this.update(sql, params) };
    }
    if (/^INSERT INTO task_queue\b/i.test(text)) {
      return { handled: true, changes: 1 };
    }
    throw new Error(`fake task_queue cannot handle statement: ${text}`);
  }
}

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly queue: FakeTaskQueue,
    private readonly fallback: FakeD1Fallback,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]): this {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    const handled = this.queue.first(this.sql, this.params);
    if (handled.handled) return handled.value as T | null;
    return (this.fallback.first?.(this.sql, this.params) ?? null) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const handled = this.queue.all(this.sql, this.params);
    if (handled.handled) return { results: handled.value as T[] };
    return { results: (this.fallback.all?.(this.sql, this.params) ?? []) as T[] };
  }

  async run(): Promise<RunMeta> {
    const handled = this.queue.run(this.sql, this.params);
    const changes = handled.handled
      ? handled.changes
      : (this.fallback.run?.(this.sql, this.params) ?? 1);
    return { meta: { changes, last_row_id: this.queue.calls.length } };
  }
}

export const createTaskQueueD1 = (
  queue: FakeTaskQueue,
  fallback: FakeD1Fallback = {}
): D1Database =>
  ({
    prepare(sql: string) {
      return new FakeStatement(queue, fallback, sql);
    }
  }) as unknown as D1Database;
