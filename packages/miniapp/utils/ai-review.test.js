const assert = require("assert");

const {
  toAiTaskStatusLabel,
  toAiTaskStatusTheme,
  toInvoiceRiskLabel,
  toInvoiceRiskTheme,
  humanizeAiText,
  buildAuditReportView,
  buildAiReportViewModel
} = require("./ai-review");

// ── AI 关卡任务态：failed/timeout 必须有独立文案，不能落回「未知」 ──
assert.strictEqual(toAiTaskStatusLabel("failed"), "失败");
assert.strictEqual(toAiTaskStatusLabel("timeout"), "超时");
assert.strictEqual(toAiTaskStatusLabel("running"), "执行中");
assert.strictEqual(toAiTaskStatusLabel("assigned"), "已派发");
assert.strictEqual(toAiTaskStatusLabel("completed"), "已完成");
assert.strictEqual(toAiTaskStatusLabel(""), "-");
assert.strictEqual(toAiTaskStatusLabel(null), "-");
// 未收录的英文码不能摆给审批人，统一落中文占位（不冒充某个已知状态）
assert.strictEqual(toAiTaskStatusLabel("odd_state"), "未知状态");
// 模型直接给中文时原样保留
assert.strictEqual(toAiTaskStatusLabel("排队中"), "排队中");
// 原型键不能命中 Object.prototype 上的函数
assert.strictEqual(toAiTaskStatusLabel("constructor"), "未知状态");

assert.strictEqual(toAiTaskStatusTheme("failed"), "danger");
assert.strictEqual(toAiTaskStatusTheme("timeout"), "danger");
assert.strictEqual(toAiTaskStatusTheme("pending"), "warning");
assert.strictEqual(toAiTaskStatusTheme("completed"), "success");
assert.strictEqual(toAiTaskStatusTheme("odd_state"), "default");

// ── 报销单项票据识别风险 ──
assert.strictEqual(toInvoiceRiskLabel("high"), "高风险");
assert.strictEqual(toInvoiceRiskLabel("medium"), "中风险");
assert.strictEqual(toInvoiceRiskLabel("low"), "低风险");
// 无值返回空串，WXML 端按空串隐藏整行
assert.strictEqual(toInvoiceRiskLabel(null), "");
assert.strictEqual(toInvoiceRiskLabel(undefined), "");
assert.strictEqual(toInvoiceRiskLabel(""), "");
// 未收录的英文码落中文占位；模型给中文时原样保留
assert.strictEqual(toInvoiceRiskLabel("weird"), "未知风险");
assert.strictEqual(toInvoiceRiskLabel("极高风险"), "极高风险");

assert.strictEqual(toInvoiceRiskTheme("high"), "danger");
assert.strictEqual(toInvoiceRiskTheme("medium"), "warning");
assert.strictEqual(toInvoiceRiskTheme("low"), "success");
assert.strictEqual(toInvoiceRiskTheme(null), "default");

// ── 报销批次 AI 审计报告视图 ──
// 接口失败/未执行（audit=null）按 none 渲染，与 web 端一致
assert.deepStrictEqual(buildAuditReportView(null), {
  statusLabel: "未执行",
  statusTheme: "default",
  reportText: ""
});

// 纯文本结果原样展示
assert.deepStrictEqual(buildAuditReportView({ status: "completed", result: "  报告全文  " }), {
  statusLabel: "已完成",
  statusTheme: "success",
  reportText: "报告全文"
});

// 模型输出不是 JSON 时服务端包成 {output}，展示时拆回原文
assert.deepStrictEqual(
  buildAuditReportView({ status: "completed", result: { output: "非结构化结论" } }),
  { statusLabel: "已完成", statusTheme: "success", reportText: "非结构化结论" }
);

// 结构化对象序列化展示（output 之外还有字段时不能只取 output）
const structured = buildAuditReportView({
  status: "completed",
  result: { output: "x", summary: "整体合规", score: 10 }
});
assert.strictEqual(structured.statusLabel, "已完成");
assert.ok(structured.reportText.indexOf("整体合规") >= 0);
// JSON 键名过 humanizeAiText 后应为中文（score → 分数），不再透出英文键
assert.ok(structured.reportText.indexOf("分数") >= 0);
assert.ok(structured.reportText.indexOf("score") === -1);

// 失败态：danger 主题、无报告文本
assert.deepStrictEqual(buildAuditReportView({ status: "failed", result: null }), {
  statusLabel: "失败",
  statusTheme: "danger",
  reportText: ""
});

assert.deepStrictEqual(buildAuditReportView({ status: "pending", result: null }), {
  statusLabel: "审计中",
  statusTheme: "warning",
  reportText: ""
});

// 未知状态落中文占位，不把英文码摆给审批人
assert.strictEqual(buildAuditReportView({ status: "odd", result: null }).statusLabel, "未知");
assert.strictEqual(buildAuditReportView({ status: "odd", result: null }).statusTheme, "default");

// ── 英文字段名汉化（展示层兜底，治存量报告） ──
assert.strictEqual(humanizeAiText("本次amount=282000超过contract.total_amount"), "本次金额=282000超过合同总额");
assert.strictEqual(humanizeAiText("recent_payments中存在同额记录"), "近期付款记录中存在同额记录");
// 句尾英文点号并进 token 也能命中
assert.strictEqual(humanizeAiText("依据为amount."), "依据为金额.");
// 未知 token（流水号、单号）原样保留
assert.strictEqual(humanizeAiText("FK-20260801-0003 无异常"), "FK-20260801-0003 无异常");
assert.strictEqual(humanizeAiText("unknown_field=1"), "unknown_field=1");
// 原型键不误命中
assert.strictEqual(humanizeAiText("constructor=1"), "constructor=1");
assert.strictEqual(humanizeAiText(null), "");

// 视图模型集成：findings 的 detail/evidence 与 score_basis 均已汉化
const humanizedVm = buildAiReportViewModel(
  {
    summary: "本单amount与合同一致",
    score: 0,
    score_basis: ["+20 超付核验：amount超出contract.total_amount"],
    findings: [
      {
        dimension: "overpayment",
        status: "warn",
        detail: "amount接近合同余额",
        evidence: "contract.paid_amount=90000"
      }
    ]
  },
  "payment",
  "completed"
);
assert.strictEqual(humanizedVm.summary, "本单金额与合同一致");
assert.strictEqual(humanizedVm.scoreBasisRows[0].text, "+20 超付核验：金额超出合同总额");
assert.strictEqual(humanizedVm.findingRows[0].detail, "金额接近合同余额");
assert.strictEqual(humanizedVm.findingRows[0].evidence, "合同已付金额=90000");

// ── 回归冒烟：既有报告视图模型未受影响 ──
const vm = buildAiReportViewModel(
  { summary: "合同整体风险可控", score: 20, score_basis: ["条款A warn +20"] },
  "contract",
  "completed"
);
assert.strictEqual(vm.hasBody, true);
assert.strictEqual(vm.summary, "合同整体风险可控");
assert.strictEqual(vm.scoreText, "风险分 20 · 中风险（20-49）");

console.log("ai-review.test.js passed");
