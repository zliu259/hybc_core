#!/usr/bin/env node
// 分批删除 event_log 里截止时间之前的 APPROVAL_TIMEOUT 历史行。方案和上线顺序见
// docs/planned/approval-timeout-event-log-cleanup.md。
//
// 默认只统计，不删除。删除必须同时写 --execute；碰生产库还要写 --remote，并且先经 owner 同意。
//
//   node scripts/cleanup-approval-timeout-events.mjs --before=2026-11-07T00:00:00.000Z --local
//   node scripts/cleanup-approval-timeout-events.mjs --before=... --remote
//   node scripts/cleanup-approval-timeout-events.mjs --before=... --remote --execute --max-batches=10
//   node scripts/cleanup-approval-timeout-events.mjs --before=... --remote --execute
//
// 中途失败可以直接重跑：每批都是独立的 DELETE，已删的不会再算一遍。

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE = "hybcdg-prod-db";
const MAX_BATCH_SIZE = 1000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(apiRoot, "node_modules/.bin/wrangler");

const fail = (message) => {
  console.error(`错误：${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const flags = new Map(
    argv.map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length > 0 ? rest.join("=") : true];
    })
  );
  const known = new Set(["before", "local", "remote", "execute", "batch-size", "sleep-ms", "max-batches"]);
  for (const key of flags.keys()) {
    if (!known.has(key)) fail(`不认识的参数 --${key}`);
  }

  const before = flags.get("before");
  if (typeof before !== "string" || !ISO_INSTANT.test(before)) {
    fail("--before 必须是形如 2026-11-07T00:00:00.000Z 的时间");
  }
  if (Number.isNaN(Date.parse(before)) || Date.parse(before) > Date.now()) {
    fail("--before 不能晚于当前时间");
  }
  if (Boolean(flags.get("local")) === Boolean(flags.get("remote"))) {
    fail("--local 和 --remote 必须且只能写一个");
  }

  const positiveInt = (key, fallback) => {
    if (!flags.has(key)) return fallback;
    const value = Number(flags.get(key));
    if (!Number.isInteger(value) || value <= 0) fail(`--${key} 必须是正整数`);
    return value;
  };
  const batchSize = positiveInt("batch-size", MAX_BATCH_SIZE);
  if (batchSize > MAX_BATCH_SIZE) fail(`--batch-size 不能超过 ${MAX_BATCH_SIZE}`);

  return {
    before,
    remote: Boolean(flags.get("remote")),
    execute: Boolean(flags.get("execute")),
    batchSize,
    sleepMs: positiveInt("sleep-ms", 1000),
    maxBatches: positiveInt("max-batches", Number.POSITIVE_INFINITY)
  };
};

const runSql = (options, sql) => {
  const target = options.remote ? ["--remote", "--env", "prod"] : ["--local"];
  const result = spawnSync(
    wrangler,
    ["d1", "execute", DATABASE, ...target, "--json", "--command", sql],
    { cwd: apiRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
  );
  if (result.error) fail(`无法运行 wrangler：${result.error.message}`);
  if (result.status !== 0) fail(`wrangler 退出码 ${result.status}\n${result.stdout}\n${result.stderr}`);
  const [first] = JSON.parse(result.stdout);
  if (!first?.success) fail(`D1 返回失败：${result.stdout}`);
  return first;
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const toMb = (bytes) => (typeof bytes === "number" ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "未知");

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  // before 已通过 ISO_INSTANT 校验，只含数字和 -:.TZ，可以安全拼进 SQL（wrangler --command 不支持绑定参数）。
  const scope = `event_type = 'APPROVAL_TIMEOUT' AND created_at < '${options.before}'`;

  const stats = runSql(
    options,
    `SELECT COUNT(*) AS total, MIN(created_at) AS earliest, MAX(created_at) AS latest FROM event_log WHERE ${scope}`
  );
  const { total, earliest, latest } = stats.results[0];
  console.log(`目标库：${options.remote ? `${DATABASE}（生产）` : `${DATABASE}（本地）`}`);
  console.log(`待删 ${total} 行，时间范围 ${earliest ?? "-"} ~ ${latest ?? "-"}`);
  console.log(`当前数据库大小：${toMb(stats.meta?.size_after)}`);

  if (!options.execute) {
    console.log("这次只统计，没有删除。确认后加 --execute。");
    return;
  }

  let deleted = 0;
  let lastSize = stats.meta?.size_after;
  for (let batch = 1; batch <= options.maxBatches; batch += 1) {
    // 用 RETURNING 计数：wrangler --local 的 meta 里没有 changes。
    const result = runSql(
      options,
      `DELETE FROM event_log WHERE id IN (SELECT id FROM event_log WHERE ${scope} ORDER BY created_at LIMIT ${options.batchSize}) RETURNING id`
    );
    const changes = result.results.length;
    if (changes === 0) break;
    deleted += changes;
    lastSize = result.meta?.size_after ?? lastSize;
    console.log(`第 ${batch} 批删除 ${changes} 行，累计 ${deleted} / ${total}，大小 ${toMb(lastSize)}`);
    await sleep(options.sleepMs);
  }

  const remaining = runSql(options, `SELECT COUNT(*) AS total FROM event_log WHERE ${scope}`);
  console.log(`完成：共删除 ${deleted} 行，范围内还剩 ${remaining.results[0].total} 行，大小 ${toMb(remaining.meta?.size_after)}`);
};

await main();
