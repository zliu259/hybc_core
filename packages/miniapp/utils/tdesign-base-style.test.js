/**
 * TDesign 按钮按旧版基础库样式写：边框画在 button 的 ::after 上，宽度靠 .t-button--block 的 width:100%。
 * app.json 开 "style": "v2" 后，基础库加了 `wx-button:not([size=mini]){width:184px;margin:auto}`
 * 和 `wx-button:after{display:none}`：按钮被压成 184px，描边按钮没有边框（2026-11-08 报销页上传按钮被截断）。
 * TDesign 的接入说明也要求去掉 style v2。
 *
 * 自定义组件的 styleIsolation 要写在 json 顶层；写在 "options" 里不生效，组件就用不上 app.wxss 的
 * .label / .required / .row（项目选择器的「所属项目」因此没有红星、字号也不对）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));

const app = readJson("app.json");
assert.ok(!("style" in app), 'app.json 不要开 "style": "v2"，TDesign 按钮会被压成 184px、描边按钮没有边框');

const picker = readJson("components/business/project-picker/index.json");
assert.strictEqual(
  picker.styleIsolation,
  "apply-shared",
  "项目选择器的 styleIsolation 要写在 json 顶层，才能用上 app.wxss 的 .label / .required / .row"
);
assert.ok(
  !(picker.options && "styleIsolation" in picker.options),
  "项目选择器 json 的 options.styleIsolation 不生效，不要留着误导"
);

// t-button 的 class 落在 TDesign 组件内部，只认写它的那个组件自己的样式，app.wxss 的 .btn 套不上
const pickerWxss = fs.readFileSync(path.join(__dirname, "..", "components/business/project-picker/index.wxss"), "utf8");
assert.match(pickerWxss, /\.btn\s*\{[^}]*flex:\s*1/, "项目选择器要在自己的 wxss 里给 .btn 写 flex:1，「刷新项目」才能撑开");

console.log("tdesign-base-style.test.js: 没开 style v2，项目选择器能用上全局样式");
