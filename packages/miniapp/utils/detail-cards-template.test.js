/**
 * WXML 模板只能看到 data 里传进去的变量，漏传时对应区块会悄悄消失，模拟器也不报错。
 * 这里静态核对：模板用到的每个顶层变量，引用它的页面都传了；模板绑定的事件，页面都实现了。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const LOCAL_NAMES = new Set(["item", "index", "task", "file", "roundItem", "true", "false", "null"]);

const templateBodies = (wxml) => {
  const bodies = {};
  const pattern = /<template name="([\w-]+)">([\s\S]*?)<\/template>/g;
  let match = pattern.exec(wxml);
  while (match) {
    bodies[match[1]] = match[2];
    match = pattern.exec(wxml);
  }
  return bodies;
};

const stripStrings = (expression) => expression.replace(/'[^']*'|"[^"]*"/g, "");

/** 取 {{ }} 表达式里的顶层变量名：a.b.c 只算 a，字符串和字面量跳过 */
const usedRoots = (body) => {
  const roots = new Set();
  const pattern = /\{\{([\s\S]*?)\}\}/g;
  // 模板里嵌套使用其他模板时，data 的键是对方的变量名，不是这个模板要的变量
  const ownBody = body.replace(/<template is=[^>]*>/g, "");
  let match = pattern.exec(ownBody);
  while (match) {
    const names = stripStrings(match[1]).match(/(^|[^.\w])([A-Za-z_]\w*)/g) || [];
    names.forEach((token) => {
      const name = token.replace(/[^\w]/g, "");
      if (!LOCAL_NAMES.has(name) && !/^\d/.test(name)) roots.add(name);
    });
    match = pattern.exec(ownBody);
  }
  return roots;
};

const usedHandlers = (body) => {
  const handlers = new Set();
  const pattern = /bindtap="(\w+)"/g;
  let match = pattern.exec(body);
  while (match) {
    handlers.add(match[1]);
    match = pattern.exec(body);
  }
  return handlers;
};

const passedKeys = (usageData) =>
  usageData
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter(Boolean);

const usages = (wxml) => {
  const found = [];
  const pattern = /<template is="([\w-]+)" data="\{\{([^}]*)\}\}"/g;
  let match = pattern.exec(wxml);
  while (match) {
    found.push({ name: match[1], keys: passedKeys(match[2]) });
    match = pattern.exec(wxml);
  }
  return found;
};

const templates = templateBodies(read("templates/detail-cards.wxml"));
assert.deepStrictEqual(Object.keys(templates).sort(), ["ai-review-body", "flow-earlier-rounds", "flow-nodes"]);

const PAGES = [
  ["pages/approval-detail/index.wxml", "pages/approval-detail/index.js"],
  ["pages/query-payment-detail/index.wxml", "pages/query-payment-detail/index.js"],
  ["pages/query-contract-detail/index.wxml", "pages/query-contract-detail/index.js"]
];

/** 付款、合同详情的折叠开关在公共模块里，用 ...DETAIL_CARD_TOGGLES 展开进页面 */
const pageSource = (jsFile) => {
  const js = read(jsFile);
  return js.includes("...DETAIL_CARD_TOGGLES") ? js + read("utils/detail-page-common.js") : js;
};

for (const [wxmlFile, jsFile] of PAGES) {
  const wxml = read(wxmlFile);
  const js = pageSource(jsFile);
  assert.ok(
    wxml.includes('<import src="../../templates/detail-cards.wxml" />'),
    `${wxmlFile} 要 import 模板`
  );
  const pageUsages = usages(wxml);
  assert.deepStrictEqual(
    pageUsages.map((item) => item.name).sort(),
    ["ai-review-body", "flow-earlier-rounds", "flow-nodes"],
    `${wxmlFile} 三个模板都要用到`
  );
  for (const { name, keys } of pageUsages) {
    const body = templates[name];
    usedRoots(body).forEach((root) => {
      assert.ok(keys.includes(root), `${wxmlFile} 使用模板 ${name} 时漏传 ${root}`);
    });
    usedHandlers(body).forEach((handler) => {
      assert.ok(new RegExp(`\\b${handler}\\(`).test(js), `${jsFile} 没有实现 ${handler}`);
    });
  }
}

console.log("detail-cards-template.test.js: ok");
