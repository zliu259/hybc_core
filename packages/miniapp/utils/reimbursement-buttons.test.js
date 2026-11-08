/**
 * app.json 开了 "style": "v2"，基础库给按钮加了 `wx-button:not([size=mini]){width:184px;margin:auto}`
 * 和 `wx-button:after{display:none}`。前一条比 TDesign 的 `.t-button--block{width:100%}` 优先级高，
 * 后一条把 TDesign 描边按钮的边框藏掉了：`block` 按钮被压成 184px 居中，长文字两头被切。
 *
 * 报销页的按钮因此统一放进 flex 行（rb-btn-row），按钮用 rb-btn（flex:1）撑开，
 * 描边按钮加 rb-btn--line 自己画边框。这里静态核对页面没有退回到 block 写法。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const wxml = read("packageFinance/reimbursement/index.wxml");
const wxss = read("packageFinance/reimbursement/index.wxss");

const attr = (attrs, name) => {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : null;
};
const hasBareAttr = (attrs, name) => new RegExp(`(?:^|\\s)${name}(?=\\s|$|/)`).test(attrs);
const classes = (attrs) => (attr(attrs, "class") || "").split(/\s+/).filter(Boolean);

/** 按标签顺序走一遍，记下每个 t-button 的属性和父元素的 class */
const collectButtons = (source) => {
  const buttons = [];
  const stack = [];
  const pattern = /<(\/?)([\w-]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g;
  let match = pattern.exec(source);
  while (match) {
    const [, closing, tag, attrs, selfClosing] = match;
    if (closing) {
      while (stack.length && stack.pop().tag !== tag) {
        // 跳过没闭合的标签
      }
    } else {
      if (tag === "t-button") {
        const parent = stack[stack.length - 1];
        buttons.push({ attrs, parentClasses: parent ? classes(parent.attrs) : [] });
      }
      if (!selfClosing) stack.push({ tag, attrs });
    }
    match = pattern.exec(source);
  }
  return buttons;
};

const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n|,)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(wxss);
  return match ? match[1] : "";
};

const buttons = collectButtons(wxml);

assert.ok(buttons.length >= 8, `报销页应找到全部按钮，实际 ${buttons.length} 个`);

for (const button of buttons) {
  const label = button.attrs.trim().slice(0, 60);
  assert.ok(!hasBareAttr(button.attrs, "block"), `t-button 不要用 block，style v2 下不是整行宽：${label}`);
  assert.ok(classes(button.attrs).includes("rb-btn"), `t-button 要带 rb-btn 才能撑开：${label}`);
  assert.ok(button.parentClasses.includes("rb-btn-row"), `t-button 要直接放在 rb-btn-row 里：${label}`);

  const variant = attr(button.attrs, "variant") || "";
  if (variant.includes("outline")) {
    // 底部按钮的 class 是表达式（第一个实心，其余描边），这里只核对写了 rb-btn--line
    assert.ok((attr(button.attrs, "class") || "").includes("rb-btn--line"), `描边按钮要带 rb-btn--line，否则没有边框：${label}`);
  }
}

assert.match(ruleBody(".rb-btn-row"), /display:\s*flex/, ".rb-btn-row 必须是 flex 行");
assert.match(ruleBody(".rb-btn"), /flex:\s*1/, ".rb-btn 必须 flex:1，才能盖过 184px 的固定宽度");
assert.match(ruleBody(".rb-btn"), /min-width:\s*0/, ".rb-btn 要 min-width:0，几个按钮并排时才能缩");
assert.match(ruleBody(".rb-btn--line"), /border:\s*1rpx solid/, ".rb-btn--line 要自己画边框");

console.log(`reimbursement-buttons.test.js: ${buttons.length} 个按钮都放在 flex 行里`);
