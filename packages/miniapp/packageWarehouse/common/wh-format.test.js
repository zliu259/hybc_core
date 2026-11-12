/** 库房分包的格式化函数。运行：node packageWarehouse/common/wh-format.test.js */
const assert = require("assert");

const {
  formatQty,
  formatTime,
  beijingToday,
  isOverdue,
  deviceLocationText,
  toQty
} = require("./wh-format");

assert.strictEqual(formatQty(3), "3");
assert.strictEqual(formatQty(2.5), "2.5");
assert.strictEqual(formatQty(1.2345), "1.235");
assert.strictEqual(formatQty("80.500"), "80.5");
assert.strictEqual(formatQty(0), "0");
assert.strictEqual(formatQty("abc"), "0");
assert.strictEqual(formatQty(null), "0");

assert.strictEqual(formatTime("2026-11-12T01:05:00.000Z"), "11-12 09:05");
assert.strictEqual(formatTime("2026-12-31T16:30:00.000Z"), "01-01 00:30");
assert.strictEqual(formatTime(null), "-");
assert.strictEqual(formatTime("not a date"), "-");

assert.strictEqual(beijingToday(new Date("2026-11-11T16:30:00.000Z")), "2026-11-12");
assert.strictEqual(beijingToday(new Date("2026-11-11T15:59:00.000Z")), "2026-11-11");

assert.strictEqual(isOverdue("2026-11-11", "2026-11-12"), true);
assert.strictEqual(isOverdue("2026-11-12", "2026-11-12"), false);
assert.strictEqual(isOverdue(null, "2026-11-12"), false);

assert.strictEqual(deviceLocationText({ location: "warehouse", storage_note: null }), "在库");
assert.strictEqual(deviceLocationText({ location: "warehouse", storage_note: "A 区" }), "在库 · A 区");
assert.strictEqual(deviceLocationText({ location: "project", project_name: "一号工程" }), "在项目：一号工程");
assert.strictEqual(deviceLocationText({ location: "project", project_name: null }), "在项目");
assert.strictEqual(deviceLocationText({ location: "scrapped" }), "已报废");
assert.strictEqual(deviceLocationText(null), "");

assert.strictEqual(toQty(""), null);
assert.strictEqual(toQty("   "), null);
assert.strictEqual(toQty(null), null);
assert.strictEqual(toQty("2.5"), 2.5);
assert.strictEqual(toQty("0"), 0);
assert.strictEqual(toQty(7), 7);
assert.ok(Number.isNaN(toQty("-1")));
assert.ok(Number.isNaN(toQty("1.2345")));
assert.ok(Number.isNaN(toQty("abc")));
assert.ok(Number.isNaN(toQty("1e3")));

console.log("wh-format tests passed");
