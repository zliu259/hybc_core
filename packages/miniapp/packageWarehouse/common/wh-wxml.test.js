/**
 * 库房各页面 WXML 的静态检查：标签成对，事件处理函数在页面里真的有。
 * 这些页面没法在 node 里渲染，写错处理函数名要到真机上点了才发现，所以在这里拦一道。
 * 运行：node packageWarehouse/common/wh-wxml.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { createPageHarness } = require("./wh-test-harness");

const ROOT = path.join(__dirname, "../..");
const SUB = path.join(ROOT, "packageWarehouse");

const pages = [
  "pages/warehouse/index",
  ...fs
    .readdirSync(SUB)
    .filter((name) => fs.existsSync(path.join(SUB, name, "index.wxml")))
    .map((name) => `packageWarehouse/${name}/index`)
];

const VOID_TAGS = new Set(["input", "image", "import", "include"]);

/** 去掉注释和 {{ }} 里的内容，免得表达式里的尖括号干扰。 */
const strip = (source) =>
  source.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{[\s\S]*?\}\}/g, "{{}}");

const checkBalanced = (page, source) => {
  const stack = [];
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let match = tagPattern.exec(source);
  while (match) {
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      assert.strictEqual(open, name, `${page}.wxml：</${name}> 对不上 <${open}>`);
    } else if (!selfClosing && !VOID_TAGS.has(name)) {
      stack.push(name);
    }
    match = tagPattern.exec(source);
  }
  assert.deepStrictEqual(stack, [], `${page}.wxml：有没关上的标签 ${stack.join("、")}`);
};

const handlersIn = (source) => {
  const names = new Set();
  const pattern = /\b(?:bind|catch|capture-bind|capture-catch):?[a-zA-Z]+="([^"]*)"/g;
  let match = pattern.exec(source);
  while (match) {
    if (match[1] && !match[1].includes("{{")) names.add(match[1]);
    match = pattern.exec(source);
  }
  return [...names];
};

let checked = 0;
for (const page of pages) {
  const source = strip(fs.readFileSync(path.join(ROOT, `${page}.wxml`), "utf8"));
  checkBalanced(page, source);
  const config = createPageHarness({ page }).loadConfig();
  for (const handler of handlersIn(source)) {
    assert.strictEqual(
      typeof config[handler],
      "function",
      `${page}.wxml 用了 ${handler}，页面里没有这个函数`
    );
  }
  // 库房页面上的项目选择器不能自己选第一个项目（会把单记到错的项目上）
  const raw = fs.readFileSync(path.join(ROOT, `${page}.wxml`), "utf8");
  for (const picker of raw.match(/<hy-project-picker[\s\S]*?\/>/g) || []) {
    assert.ok(
      picker.includes('autoSelect="{{false}}"'),
      `${page}.wxml 的项目选择器要写 autoSelect="{{false}}"`
    );
  }
  for (const file of ["json", "wxss"]) {
    assert.ok(fs.existsSync(path.join(ROOT, `${page}.${file}`)), `${page}.${file} 不存在`);
  }
  JSON.parse(fs.readFileSync(path.join(ROOT, `${page}.json`), "utf8"));
  checked += 1;
}

assert.ok(checked >= 2, "至少要查到库房 tab 页和一个分包页面");
console.log(`wh-wxml: ${checked} pages ok`);
