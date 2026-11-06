// 审计 payment_request.amount_cn，并生成待审的回刷 SQL。不连数据库，也不执行任何写入：
// 输入是 wrangler 导出的 JSON，输出是统计和本地 SQL 文件。输出含单号和金额，不要入库。
//
// 用法（在 packages/api 下）：
//   node_modules/.bin/wrangler d1 execute hybcdg-prod-db --remote --env prod --json \
//     --command "SELECT id, serial_no, amount, amount_cn, status, legacy_data_id, created_at FROM payment_request ORDER BY id" \
//     > /tmp/amount-cn-rows.json
//   node --experimental-strip-types --no-warnings scripts/amount-cn-audit.mjs /tmp/amount-cn-rows.json /tmp/amount-cn-refresh
//
// 第二个参数是 SQL 文件前缀，不传就只出统计。SQL 按批分文件，由 owner 决定跑哪几批。
import { readFileSync, writeFileSync } from "node:fs";
import { canConvertAmount, toAmountChinese } from "../src/services/amount-cn.ts";

const ARCHIVED_STATUSES = new Set(["paid", "cancelled", "rejected"]);
const BATCHES = [
  { key: "1-active", label: "在途单（未归档）" },
  { key: "2-new-archived", label: "系统内新建、已归档" },
  { key: "3-legacy", label: "旧系统导入（amount_cn 是导入时重算的）" }
];

const DIGITS = new Map([..."壹贰叁肆伍陆柒捌玖"].map((char, index) => [char, index + 1]));
const SMALL_UNITS = new Map([
  ["拾", 10],
  ["佰", 100],
  ["仟", 1000]
]);

const parseBelowWan = (text) => {
  let total = 0;
  let digit = 0;
  for (const char of text) {
    if (SMALL_UNITS.has(char)) {
      total += digit * SMALL_UNITS.get(char);
      digit = 0;
    } else {
      if (!DIGITS.has(char)) return Number.NaN;
      digit = DIGITS.get(char);
    }
  }
  return total + digit;
};

const splitOn = (text, unit) => (text.includes(unit) ? text.split(unit) : ["", text]);

const parseYuan = (text) => {
  const [yi, belowYi] = splitOn(text, "亿");
  const [yiHigh, yiLow] = splitOn(yi, "万");
  const [wan, ones] = splitOn(belowYi, "万");
  return (
    (parseBelowWan(yiHigh) * 1e4 + parseBelowWan(yiLow)) * 1e8 +
    parseBelowWan(wan) * 1e4 +
    parseBelowWan(ones)
  );
};

// 忽略"零"后读出大写表示的分值：旧算法多写或漏写零，但金额数值是对的。
const parseCents = (text) => {
  const body = text.replace(/^负/, "").replace(/零/g, "");
  const [yuanText, rest] = body.includes("元") ? body.split("元") : ["", body];
  const jiao = /(.)角/.exec(rest)?.[1];
  const fen = /(.)分/.exec(rest)?.[1];
  const tail = rest.replace(/.角/, "").replace(/.分/, "").replace("整", "");
  if (tail !== "") return Number.NaN;
  return (
    parseYuan(yuanText) * 100 +
    (jiao ? (DIGITS.get(jiao) ?? Number.NaN) * 10 : 0) +
    (fen ? (DIGITS.get(fen) ?? Number.NaN) : 0)
  );
};

const classify = (row) => {
  if (typeof row.amount !== "number" || !canConvertAmount(row.amount)) {
    return { kind: "value_mismatch", expected: null };
  }
  const expected = toAmountChinese(row.amount);
  if (row.amount_cn === expected) return { kind: "ok", expected };
  const text = typeof row.amount_cn === "string" ? row.amount_cn : "";
  const sameValue = text !== "" && parseCents(text) === Math.round(Math.abs(row.amount) * 100);
  return { kind: sameValue ? "format_only" : "value_mismatch", expected };
};

const batchOf = (row) => {
  if (row.legacy_data_id !== null && row.legacy_data_id !== undefined) return "3-legacy";
  return ARCHIVED_STATUSES.has(row.status) ? "2-new-archived" : "1-active";
};

const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

const loadRows = (path) => {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(parsed) ? parsed[0]?.results : undefined;
  if (!Array.isArray(rows)) throw new Error(`${path} 不是 wrangler d1 --json 的输出`);
  for (const key of ["id", "serial_no", "amount", "amount_cn", "status", "legacy_data_id"]) {
    if (rows.length > 0 && !(key in rows[0])) throw new Error(`导出缺少字段 ${key}`);
  }
  return rows;
};

const [inputPath, sqlPrefix] = process.argv.slice(2);
if (!inputPath) {
  console.error("用法见文件头注释");
  process.exit(1);
}

const audited = loadRows(inputPath).map((row) => ({ row, ...classify(row), batch: batchOf(row) }));
const count = (predicate) => audited.filter(predicate).length;

console.log(`总行数 ${audited.length}，写法错 ${count((a) => a.kind === "format_only")}，数值不符 ${count((a) => a.kind === "value_mismatch")}`);
console.log("\n批次 | 状态 | 行数 | 写法错 | 数值不符");
const groups = [...new Set(audited.map((a) => `${a.batch}|${a.row.status}`))].sort();
for (const group of groups) {
  const inGroup = audited.filter((a) => `${a.batch}|${a.row.status}` === group);
  const wrong = inGroup.filter((a) => a.kind === "format_only").length;
  const mismatch = inGroup.filter((a) => a.kind === "value_mismatch").length;
  console.log(`${group.replace("|", " | ")} | ${inGroup.length} | ${wrong} | ${mismatch}`);
}
const since = "2026-07-22T12:53";
console.log(`\n${since} 之后新建且写法错：${count((a) => a.kind === "format_only" && String(a.row.created_at) >= since)}`);

const mismatches = audited.filter((a) => a.kind === "value_mismatch");
if (mismatches.length > 0) {
  console.log("\n数值不符（不进回刷 SQL，需人工核对）：");
  for (const { row } of mismatches) console.log(`  id=${row.id} ${row.serial_no} status=${row.status}`);
}

if (sqlPrefix) {
  for (const { key, label } of BATCHES) {
    const fixes = audited.filter((a) => a.kind === "format_only" && a.batch === key);
    const header = [
      `-- payment_request.amount_cn 回刷：${label}，${fixes.length} 行。不是 migration，不要放进 migrations/。`,
      "-- 只改 amount_cn，不动 amount、状态、updated_at。WHERE 锁定 id + amount + 旧值，行被改过就跳过，可重复执行。",
      `-- 执行：cd packages/api && node_modules/.bin/wrangler d1 execute hybcdg-prod-db --remote --env prod --file <本文件>`
    ];
    const statements = fixes.map(
      ({ row, expected }) =>
        `UPDATE payment_request SET amount_cn = ${sqlText(expected)} WHERE id = ${row.id} AND amount = ${row.amount} AND amount_cn = ${sqlText(row.amount_cn)};`
    );
    const path = `${sqlPrefix}-${key}.sql`;
    writeFileSync(path, `${[...header, "", ...statements].join("\n")}\n`);
    console.log(`\n${path}：${fixes.length} 行`);
  }
}
