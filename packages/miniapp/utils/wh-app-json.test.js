/**
 * 库房页面的注册情况：旧页面都下线了，新分包正好是定下的这些页面，仓库里没有指向旧页面的地方。
 * 这些页面路径写进企微卡片后不能再改，所以在这里钉住。运行：node utils/wh-app-json.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));

const OLD_PAGES = [
  "pages/warehouse-task/index",
  "pages/warehouse-stock-order/index",
  "pages/warehouse-inventory/index",
  "pages/warehouse-dispatch/index",
  "pages/warehouse-stocktake/index",
  "pages/asset/index"
];
const SUB_PAGES = [
  "device/index",
  "task-list/index",
  "task-detail/index",
  "task-new/index",
  "kit-list/index",
  "kit/index",
  "ship/index",
  "project/index",
  "material/index",
  "docs/index",
  "doc-view/index",
  "doc-upload/index",
  "stocktake/index"
];

OLD_PAGES.forEach((page) => {
  assert.ok(!app.pages.includes(page), `app.json 里还有旧页面 ${page}`);
  assert.ok(!fs.existsSync(path.join(ROOT, `${page}.js`)), `旧页面的文件还在：${page}`);
});
assert.ok(app.pages.includes("pages/warehouse/index"), "库房 tab 页要在主包");
assert.ok(
  app.tabBar.list.some((tab) => tab.pagePath === "pages/warehouse/index"),
  "库房要在 tabBar 里"
);

const sub = app.subPackages.find((item) => item.root === "packageWarehouse");
assert.ok(sub, "app.json 里没有 packageWarehouse 分包");
assert.deepStrictEqual(sub.pages.slice().sort(), SUB_PAGES.slice().sort());
SUB_PAGES.forEach((page) => {
  ["js", "json", "wxml", "wxss"].forEach((ext) => {
    assert.ok(
      fs.existsSync(path.join(ROOT, "packageWarehouse", `${page}.${ext}`)),
      `packageWarehouse/${page}.${ext} 不存在`
    );
  });
});

// 仓库里不能再有指向旧页面的地方（跳转、路径常量）
const SKIP_DIRS = new Set(["node_modules", "miniprogram_npm", "tdesign-miniprogram", ".git"]);
const SOURCE_EXT = new Set([".js", ".wxml", ".json", ".wxss"]);
const stale = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    // 测试文件自己会提到旧路径；带空格的 " 2." 文件是别处留下的未跟踪副本
    if (!SOURCE_EXT.has(path.extname(entry.name)) || entry.name.endsWith(".test.js")) continue;
    if (/ \d+\.[a-z]+$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (/pages\/warehouse-|pages\/asset\//.test(text)) stale.push(path.relative(ROOT, full));
  }
};
walk(ROOT);
assert.deepStrictEqual(stale, [], `这些文件还指向旧的库房页面：${stale.join("、")}`);

console.log("wh-app-json tests passed");
