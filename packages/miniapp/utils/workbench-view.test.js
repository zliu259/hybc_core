/** 工作台的视图模型。运行：node utils/workbench-view.test.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildEntrySections,
  buildGreeting,
  buildPendingPreview,
  buildTodoTiles,
  rankEntries
} = require("./workbench-view");

const keysOf = (items) => items.map((item) => item.key);

// ── 常用入口按角色 ──
const siteManager = buildEntrySections(["site_manager"], {});
assert.deepStrictEqual(keysOf(siteManager.common), [
  "managerLog",
  "operatorLog",
  "projects",
  "reimbursement",
  "paymentApply",
  "asset",
  "survey",
  "initiated"
]);

const manager = buildEntrySections(["manager"], {});
assert.strictEqual(manager.common[0].key, "dashboard");
assert.ok(keysOf(manager.common).includes("query"));

const finance = buildEntrySections(["finance"], {});
assert.strictEqual(finance.common[0].key, "query");
assert.ok(!keysOf(finance.common).includes("asset"), "财务调不了设备接口");

const operator = buildEntrySections(["operator"], {});
assert.strictEqual(operator.common[0].key, "operatorLog");
assert.ok(!keysOf(operator.common).includes("managerLog"), "操作手没有项目日志写权限");
assert.strictEqual(operator.common.length, 8);

// 每个入口都只出现一次，全部功能里不重复常用的，所有能用的入口都找得到
const allKeys = [...keysOf(manager.common), ...keysOf(manager.more)];
assert.strictEqual(new Set(allKeys).size, allKeys.length);
assert.ok(allKeys.includes("projectCreate"));
assert.ok(allKeys.includes("approvalRecords"));

// 权限和后端一致：没有权限的入口哪里都不出现
const operatorKeys = [...keysOf(operator.common), ...keysOf(operator.more)];
["query", "dashboard", "contractPrecheck", "projectCreate", "managerLog"].forEach((key) => {
  assert.ok(!operatorKeys.includes(key), `操作手不该看到 ${key}`);
});
const financeKeys = [...keysOf(finance.common), ...keysOf(finance.more)];
["asset", "survey", "progress", "operatorLog", "dashboard"].forEach((key) => {
  assert.ok(!financeKeys.includes(key), `财务不该看到 ${key}`);
});

// 多角色按权限最高的给默认顺序
assert.strictEqual(buildEntrySections(["operator", "manager"], {}).common[0].key, "dashboard");
// 没有角色时不报错，只给人人能用的
const noRole = buildEntrySections([], {});
assert.ok(noRole.common.length > 0);
assert.ok(!keysOf(noRole.common).includes("dashboard"));

// 入口都能跳转，文字不长于 4 个字，图标文件真实存在（图片路径写错不报错，只会显示空白）
[...manager.common, ...manager.more, ...operator.common, ...finance.common].forEach((item) => {
  assert.ok(item.path.startsWith("/"), item.key);
  assert.ok(item.label.length <= 4, item.label);
  assert.ok(fs.existsSync(path.join(__dirname, "..", item.icon)), `缺图标 ${item.icon}`);
});

// ── 用得多的往前排 ──
const entries = [{ key: "a" }, { key: "b" }, { key: "c" }];
assert.deepStrictEqual(keysOf(rankEntries(entries, {})), ["a", "b", "c"]);
// 用过一两次不动，位置不能因为误点就变
assert.deepStrictEqual(keysOf(rankEntries(entries, { c: 2 })), ["a", "b", "c"]);
assert.deepStrictEqual(keysOf(rankEntries(entries, { c: 3 })), ["c", "a", "b"]);
assert.deepStrictEqual(keysOf(rankEntries(entries, { b: 3, c: 9 })), ["c", "b", "a"]);
// 不改原数组
assert.deepStrictEqual(keysOf(entries), ["a", "b", "c"]);

// 全部功能里用得多的会进常用，被挤出来的进全部功能
const learned = buildEntrySections(["operator"], { contractPrecheck: 9, fuel: 5, query: 5 });
assert.strictEqual(learned.common[0].key, "fuel", "没有权限的入口次数不算");
const promoted = buildEntrySections(["manager"], { fuel: 4 });
assert.strictEqual(promoted.common[0].key, "fuel");
assert.strictEqual(promoted.common.length, 8);
assert.ok(keysOf(promoted.more).includes("initiated"));

// ── 待办数字 ──
const counts = { pending: 12, returned: 2, review: 3, warning: 0, tasks: 0 };
const tiles = buildTodoTiles(["manager"], counts);
assert.deepStrictEqual(
  tiles.map((tile) => [tile.key, tile.countText, tile.alert]),
  [
    ["pending", "12", true],
    ["returned", "2", true],
    ["review", "3", true],
    ["warning", "0", false]
  ],
  "最多放 4 个，超出时先去掉没有事的"
);
assert.strictEqual(tiles[0].path, "/pages/approval/index");
assert.strictEqual(tiles[1].path, "/pages/approval-initiated/index");
assert.strictEqual(tiles[2].path, "/pages/external-log-review/index");
assert.strictEqual(tiles[3].path, "/pages/progress/index");

// 有事的不能被挤掉
const busy = buildTodoTiles(["manager"], { ...counts, warning: 1, tasks: 4 });
assert.strictEqual(busy.length, 5);
assert.deepStrictEqual(
  keysOf(buildTodoTiles(["manager"], { pending: 0, returned: 0, review: 0, warning: 0, tasks: 4 })),
  ["pending", "returned", "review", "tasks"]
);

// 按角色：财务没有复核、预警、库房任务
assert.deepStrictEqual(keysOf(buildTodoTiles(["finance"], counts)), ["pending", "returned"]);
// 操作手没有复核
assert.deepStrictEqual(keysOf(buildTodoTiles(["operator"], counts)), ["pending", "returned", "warning", "tasks"]);

// 没取到的数字不能显示成 0，否则像是没有待办
const unknown = buildTodoTiles(["finance"], { pending: null, returned: 0 });
assert.strictEqual(unknown[0].countText, "-");
assert.strictEqual(unknown[0].alert, false);

// ── 待审批预览 ──
const preview = buildPendingPreview(
  [
    {
      id: 1,
      biz_type: "payment_request",
      biz_summary: "PM-1 | 2026.9 工资",
      biz_amount: 405072,
      initiator_userid: "LiuPeng",
      submitted_at: "2026-11-05T06:20:00.000Z"
    },
    { id: 2, biz_type: "outbound_contract", biz_summary: "", biz_amount: null, initiator_userid: null, submitted_at: null },
    { id: 3, biz_type: "stock_order", biz_summary: "WO-1 | inbound", initiator_userid: "x" },
    { id: 4, biz_type: "payment_request", biz_summary: "第四条" }
  ],
  (id) => ({ LiuPeng: "刘鹏" })[id] || "未知人员"
);
assert.strictEqual(preview.length, 3, "最多露 3 条");
assert.strictEqual(preview[0].title, "2026.9 工资", "一行放不下，先看内容不看单号");
assert.strictEqual(preview[0].amountText, "¥405,072.00");
assert.strictEqual(preview[0].metaText, "付款审批  刘鹏  11-05 14:20");
assert.strictEqual(preview[1].title, "对外合同审批");
assert.strictEqual(preview[1].amountText, "");
assert.strictEqual(preview[1].metaText, "对外合同审批");
assert.strictEqual(preview[2].title, "入库");
// 只有单号、或者不是这种写法时原样显示
assert.strictEqual(
  buildPendingPreview([{ id: 5, biz_type: "x", biz_summary: "PM-1 | " }], () => "")[0].title,
  "PM-1 |"
);
assert.strictEqual(
  buildPendingPreview([{ id: 6, biz_type: "x", biz_summary: "合同 A | 甲方" }], () => "")[0].title,
  "合同 A | 甲方"
);

// ── 问候 ──
const at = (iso) => buildGreeting(new Date(iso), "刘鹏");
assert.deepStrictEqual(at("2026-11-06T00:30:00.000Z"), { text: "早上好，刘鹏", dateText: "11月6日 周五" });
assert.strictEqual(at("2026-11-06T03:00:00.000Z").text, "上午好，刘鹏");
assert.strictEqual(at("2026-11-06T06:00:00.000Z").text, "下午好，刘鹏");
assert.strictEqual(at("2026-11-06T12:00:00.000Z").text, "晚上好，刘鹏");
// 跨天按北京时间
assert.strictEqual(at("2026-11-06T17:00:00.000Z").dateText, "11月7日 周六");
assert.strictEqual(buildGreeting(new Date("2026-11-06T06:00:00.000Z"), "").text, "下午好");

console.log("workbench-view: ok");
