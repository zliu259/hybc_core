const assert = require("assert");

const {
  aiDecisionFromComment,
  splitRemark,
  buildCoverageView,
  buildAiPanel,
  buildBizView,
  buildReimbursementItemRows,
  buildTimelineNodes,
  formatBeijingTime,
  extractStopReason,
  parseAttachments,
  withFileSizeText,
  fileNameExtLabel
} = require("./approval-detail-view");

const formatTime = (value) => (value ? `T(${value})` : "-");
const ctx = {
  user: (id) => (id ? `人员${id}` : "未匹配"),
  project: (id) => (id ? `项目${id}` : "未匹配"),
  entity: (id) => (id ? `主体${id}` : "未匹配"),
  formatTime
};

// ── 判定前缀是跨端契约（api ai-gate-result.ts / web ai-review.ts），字符串不能漂 ──
assert.strictEqual(aiDecisionFromComment("AI审查不通过：金额不符"), "reject");
assert.strictEqual(aiDecisionFromComment("AI审查放行（需人工重点关注）：疑点"), "warn");
assert.strictEqual(aiDecisionFromComment("AI审查通过：未见异常"), "pass");
assert.strictEqual(aiDecisionFromComment("人工意见"), null);
assert.strictEqual(aiDecisionFromComment(null), null);

// ── 备注分离 ──
const remark = [
  "请尽快付款",
  "[超管修改 2026-10-01T02:03:04.000Z] zhangsan：小程序审批页更新支付信息",
  "二行备注",
  "[超管修改 2026-10-02T02:03:04.000Z] lisi:审批页更新支付信息"
].join("\n");
assert.deepStrictEqual(splitRemark(remark), {
  text: "请尽快付款\n二行备注",
  edits: [
    { at: "2026-10-01T02:03:04.000Z", by: "zhangsan", note: "小程序审批页更新支付信息" },
    { at: "2026-10-02T02:03:04.000Z", by: "lisi", note: "审批页更新支付信息" }
  ]
});
assert.deepStrictEqual(splitRemark(null), { text: "", edits: [] });
assert.deepStrictEqual(splitRemark("[超管修改 没有闭合"), { text: "[超管修改 没有闭合", edits: [] });

// ── AI 读取范围 ──
assert.strictEqual(buildCoverageView(null), null);
assert.strictEqual(buildCoverageView(undefined), null);
assert.strictEqual(buildCoverageView("x"), null);
// 缺 complete 字段不能当成读完了，也不能当成没读完
assert.strictEqual(buildCoverageView({ items: [] }), null);

const incomplete = buildCoverageView({
  complete: false,
  summary: "未读完：《工资表.pdf》共 6 页，已读 3 页，未读第 4-6 页",
  items: [
    { name: "合同.pdf", status: "complete", description: "《合同.pdf》全部 4 页已读" },
    {
      name: "工资表.pdf",
      status: "partial",
      pages_total: 6,
      pages_read: 3,
      description: "《工资表.pdf》共 6 页，已读 3 页，未读第 4-6 页"
    }
  ]
});
assert.strictEqual(incomplete.incomplete, true);
assert.ok(incomplete.title.indexOf("没有读完") >= 0);
assert.deepStrictEqual(
  incomplete.rows.map((row) => row.text),
  ["《工资表.pdf》共 6 页，已读 3 页，未读第 4-6 页"]
);

// items 残缺时退回 summary，告警不能变成空壳
assert.deepStrictEqual(
  buildCoverageView({ complete: false, summary: "未读完：附件下载失败", items: [] }).rows.map((row) => row.text),
  ["未读完：附件下载失败"]
);
// description 缺失时按页数现算
assert.deepStrictEqual(
  buildCoverageView({
    complete: false,
    items: [{ name: "a.pdf", status: "partial", pages_total: 6, pages_read: 3 }]
  }).rows.map((row) => row.text),
  ["《a.pdf》共 6 页，已读 3 页"]
);
// 什么信息都没有也要有兜底文案
assert.strictEqual(buildCoverageView({ complete: false }).rows.length, 1);

const complete = buildCoverageView({
  complete: true,
  summary: "附件已全部读取",
  items: [{ name: "合同.pdf", status: "complete", description: "《合同.pdf》全部 4 页已读" }]
});
assert.strictEqual(complete.incomplete, false);
assert.ok(complete.text.indexOf("《合同.pdf》全部 4 页已读") >= 0);

// ── AI 审查区 ──
assert.deepStrictEqual(buildAiPanel([], {}, formatTime), { latest: null, earlier: [] });
assert.deepStrictEqual(buildAiPanel(null, {}, formatTime), { latest: null, earlier: [] });

const newReview = {
  task_id: 2,
  node_key: "ai_gate_pay",
  status: "completed",
  summary: "amount 与工资表合计一致",
  decision: "warn",
  outcome: "approve",
  comment: "AI审查放行（需人工重点关注）：amount 与工资表合计一致｜关注点：subject_match：主体待核对",
  recommendations: ["核对 counterparty 全称"],
  findings: [
    { dimension: "amount_terms", status: "pass", detail: "金额一致", evidence: "" },
    { dimension: "subject_match", status: "warn", detail: "主体疑似不一致", evidence: "第2页 amount=1" },
    { dimension: "overpayment", status: "fail", detail: "超付", evidence: "" }
  ],
  evidence_coverage: {
    complete: false,
    summary: "未读完",
    items: [{ name: "a.pdf", status: "partial", description: "《a.pdf》未读第 4-6 页" }]
  },
  completed_at: "2026-11-02T00:00:00Z"
};
const oldReview = {
  task_id: 1,
  node_key: "ai_gate_pay",
  status: "completed",
  summary: null,
  outcome: "reject",
  comment: "AI审查不通过：只读到前 3 页，合计不符",
  completed_at: "2026-10-31T00:00:00Z"
};

const panel = buildAiPanel([newReview, oldReview], { ai_gate_pay: "AI付款审查" }, formatTime);
assert.strictEqual(panel.latest.verdictLabel, "放行·需人工关注");
assert.strictEqual(panel.latest.verdictTheme, "warning");
// 英文字段名过 humanizeAiText，审批人不认识 amount
assert.strictEqual(panel.latest.summary, "金额 与工资表合计一致");
assert.strictEqual(panel.latest.commentFallback, "");
assert.strictEqual(panel.latest.coverage.incomplete, true);
// 非 pass 逐条列出（fail 排在 warn 前），pass 折叠
assert.deepStrictEqual(
  panel.latest.concerns.map((row) => [row.dimensionLabel, row.statusLabel, row.statusTheme]),
  [
    ["超付核验", "异常", "danger"],
    ["签约主体", "关注", "warning"]
  ]
);
assert.strictEqual(panel.latest.concerns[1].evidence, "第2页 金额=1");
assert.deepStrictEqual(
  panel.latest.passed.map((row) => row.dimensionLabel),
  ["金额条款"]
);
assert.deepStrictEqual(
  panel.latest.recommendations.map((row) => row.text),
  ["核对 合同相对方 全称"]
);
assert.strictEqual(panel.latest.nodeLabel, "AI付款审查");
assert.strictEqual(panel.latest.completedAtText, "T(2026-11-02T00:00:00Z)");
// 之前轮次折叠
assert.strictEqual(panel.earlier.length, 1);
assert.strictEqual(panel.earlier[0].verdictLabel, "建议拒绝");
assert.strictEqual(panel.earlier[0].verdictTheme, "danger");
assert.strictEqual(panel.earlier[0].coverageIncomplete, false);

// 旧数据：没有 findings/evidence_coverage，回退 comment
const legacyPanel = buildAiPanel([oldReview], {}, formatTime);
assert.strictEqual(legacyPanel.latest.summary, "AI审查不通过：只读到前 3 页，合计不符");
assert.strictEqual(legacyPanel.latest.commentFallback, "");
assert.strictEqual(legacyPanel.latest.coverage, null);
assert.deepStrictEqual(legacyPanel.latest.concerns, []);
assert.deepStrictEqual(legacyPanel.latest.passed, []);
assert.deepStrictEqual(legacyPanel.latest.recommendations, []);
assert.strictEqual(legacyPanel.latest.nodeLabel, "AI 关卡");

// 旧数据：summary 和 comment 不同，两句都要留
const bothPanel = buildAiPanel(
  [{ ...oldReview, summary: "金额异常", comment: "AI审查不通过：金额异常｜依据：amount_terms：合计不符" }],
  {},
  formatTime
);
assert.strictEqual(bothPanel.latest.summary, "金额异常");
assert.strictEqual(bothPanel.latest.commentFallback, "AI审查不通过：金额异常｜依据：金额条款：合计不符");

// 旧数据：summary 是裸 JSON（含代码块），拆开取值，不把 JSON 摆给审批人
const fenced = "```json\n" + JSON.stringify({ outcome: "reject", comment: "材料不全，请补充资料" }) + "\n```";
const embedded = buildAiPanel([{ task_id: 9, status: "completed", summary: fenced }], {}, formatTime);
assert.strictEqual(embedded.latest.summary, "材料不全，请补充资料");
assert.strictEqual(embedded.latest.verdictLabel, "建议补充材料");
assert.strictEqual(embedded.latest.verdictTheme, "warning");

// 脏 findings：非数组、非对象、原型键都不能把页面搞崩
const dirty = buildAiPanel(
  [
    {
      task_id: 3,
      status: "completed",
      comment: "AI审查通过：未见异常",
      findings: [null, "x", { dimension: "constructor", status: "toString", detail: 1, evidence: {} }],
      evidence_coverage: "bad"
    }
  ],
  {},
  formatTime
);
assert.strictEqual(dirty.latest.verdictLabel, "建议通过");
assert.strictEqual(dirty.latest.coverage, null);
assert.strictEqual(dirty.latest.concerns.length, 1);
assert.strictEqual(dirty.latest.concerns[0].dimensionLabel, "其他维度");
assert.strictEqual(dirty.latest.concerns[0].detail, "");
assert.strictEqual(dirty.latest.concerns[0].statusTheme, "default");
assert.strictEqual(buildAiPanel([{ task_id: 4, findings: "bad" }], {}, formatTime).latest.concerns.length, 0);

// 进行中 / 失败：不能给判定，要明确告诉审批人
const running = buildAiPanel([{ task_id: 5, status: "running" }], {}, formatTime).latest;
assert.strictEqual(running.state, "running");
assert.strictEqual(running.verdictLabel, "审查中");
assert.ok(running.summary.indexOf("不影响") >= 0);
const failed = buildAiPanel(
  [{ task_id: 6, status: "failed", error_message: "provider returned 401" }],
  {},
  formatTime
).latest;
assert.strictEqual(failed.state, "failed");
assert.strictEqual(failed.verdictLabel, "审查失败");
assert.strictEqual(failed.verdictTheme, "danger");
assert.ok(failed.summary.indexOf("请人工审核") >= 0);
assert.ok(failed.errorText.length > 0);
const timedOut = buildAiPanel([{ task_id: 7, status: "timeout" }], {}, formatTime).latest;
assert.strictEqual(timedOut.state, "failed");
const cancelled = buildAiPanel([{ task_id: 8, status: "cancelled" }], {}, formatTime).latest;
assert.strictEqual(cancelled.state, "cancelled");
assert.strictEqual(cancelled.verdictLabel, "已撤回");

// ── 业务视图：金额大写现算，不读 amount_cn ──
const instance = {
  instance_no: "AP-1",
  biz_type: "payment_request",
  biz_summary: "付款摘要",
  status: "in_progress",
  initiator_userid: "u1",
  submitted_at: "2026-11-01T00:00:00Z",
  completed_at: null
};
const payment = {
  id: 1,
  serial_no: "SP-20261102-0004",
  amount: 100500,
  amount_cn: "壹拾零万零伍佰零元",
  content: "2026.9 工资",
  project_id: 7,
  category: "progress",
  expected_payment_date: "2026-11-10",
  payment_method: "personal_transfer",
  remark: "正文\n[超管修改 2026-10-01T02:03:04.000Z] u9：审批页更新支付信息",
  payee: { name: "北京鑫丰畅", bank_name: "工行", bank_account: "6222" },
  contract_id: 3,
  contract: { contract_no: "CT-1", counterparty: "北京鑫丰畅" }
};
const paymentView = buildBizView({ instance, bizDetail: payment, ctx });
assert.strictEqual(paymentView.hero.amountLabel, "申请金额");
assert.strictEqual(paymentView.hero.amountText, "100,500.00");
assert.strictEqual(paymentView.hero.amountUpper, "壹拾万零伍佰元整");
assert.strictEqual(paymentView.hero.title, "2026.9 工资");
assert.strictEqual(paymentView.hero.bizNo, "SP-20261102-0004");
assert.deepStrictEqual(paymentView.hero.facts.slice(0, 3), [
  { label: "收款方", value: "北京鑫丰畅" },
  { label: "所属项目", value: "项目7" },
  { label: "发起人", value: "人员u1" }
]);
const rowOf = (view, label) => view.rows.find((row) => row.label === label);
assert.strictEqual(rowOf(paymentView, "备注").value, "正文");
assert.strictEqual(rowOf(paymentView, "付款类别").value, "进度款");
assert.strictEqual(rowOf(paymentView, "付款方式").value, "转账");
assert.strictEqual(rowOf(paymentView, "收款账号").value, "工行 / 6222");
assert.strictEqual(rowOf(paymentView, "关联合同").value, "CT-1 - 北京鑫丰畅");
assert.strictEqual(rowOf(paymentView, "审批摘要").value, "付款摘要");
assert.deepStrictEqual(paymentView.remarkEdits, [
  { key: "edit-0", atText: "T(2026-10-01T02:03:04.000Z)", byText: "人员u9", note: "审批页更新支付信息" }
]);
assert.strictEqual(
  buildBizView({ instance, bizDetail: { ...payment, contract: null, contract_id: null, payee: null }, ctx }).rows[0].value,
  "无合同 / 无需合同"
);

// 只有修改日志、没有正文时备注显示占位，日志不进正文
const logOnly = buildBizView({
  instance,
  bizDetail: { ...payment, remark: "[超管修改 2026-10-01T02:03:04.000Z] u9：x" },
  ctx
});
assert.strictEqual(rowOf(logOnly, "备注").value, "-");
assert.strictEqual(logOnly.remarkEdits.length, 1);

// 事由与摘要相同时不重复
assert.strictEqual(
  rowOf(buildBizView({ instance: { ...instance, biz_summary: "2026.9 工资" }, bizDetail: payment, ctx }), "审批摘要"),
  undefined
);
// 金额缺失时不显示「0.00」冒充
const noAmount = buildBizView({ instance, bizDetail: { ...payment, amount: null }, ctx });
assert.strictEqual(noAmount.hero.amountText, "");

// 合同
const contractView = buildBizView({
  instance: { ...instance, biz_type: "outbound_contract" },
  bizDetail: {
    contract_no: "CT-9",
    total_amount: 1000001,
    paid_amount: 10,
    counterparty: "乙方",
    contract_type: "labor",
    direction: "outbound",
    entity_id: 2,
    project_id: 7,
    handler_userid: "u3",
    contract_date: "2026-01-01",
    remark: ""
  },
  ctx
});
assert.strictEqual(contractView.hero.amountLabel, "合同金额");
assert.strictEqual(contractView.hero.amountUpper, "壹佰万零壹元整");
assert.strictEqual(contractView.hero.title, "乙方 · 人工");
assert.strictEqual(contractView.detailTitle, "合同明细");
assert.deepStrictEqual(contractView.hero.facts[0], { label: "我方主体", value: "主体2" });
assert.strictEqual(rowOf(contractView, "经办人").value, "人员u3");
assert.strictEqual(rowOf(contractView, "已付金额").value, "10.00");

// 合同金额变更
const changeView = buildBizView({
  instance: { ...instance, biz_type: "contract_amount_change" },
  bizDetail: {
    old_amount: 100,
    new_amount: 200.5,
    applicant_userid: "u4",
    reason: "增加工程量",
    contract: {
      contract_no: "CT-2",
      direction: "inbound",
      project_id: 7,
      counterparty: "甲方",
      received_amount: 50,
      paid_amount: 0
    }
  },
  ctx
});
assert.strictEqual(changeView.hero.amountLabel, "新合同金额");
assert.strictEqual(changeView.hero.amountUpper, "贰佰元伍角");
assert.strictEqual(changeView.hero.title, "甲方 合同金额变更");
assert.strictEqual(rowOf(changeView, "原合同金额").value, "100.00（壹佰元整）");
assert.strictEqual(rowOf(changeView, "变更差额").value, "增加 100.50");
assert.strictEqual(rowOf(changeView, "已收金额").value, "50.00");
assert.strictEqual(rowOf(changeView, "变更缘由").multiline, true);

// 合同已被删除时变更单还要能看：事由回退摘要，金额照常显示
const orphanChange = buildBizView({
  instance: { ...instance, biz_type: "contract_amount_change" },
  bizDetail: { old_amount: 100, new_amount: 200, reason: "", attachments: [], contract: null },
  ctx
});
assert.strictEqual(orphanChange.hero.title, "付款摘要");
assert.strictEqual(orphanChange.hero.bizNo, "AP-1");
assert.strictEqual(rowOf(orphanChange, "已付金额").value, "-");
assert.strictEqual(rowOf(orphanChange, "变更缘由").value, "-");
assert.strictEqual(rowOf(orphanChange, "附件").value, "申请人未上传附件");

// 报销批次
const batchView = buildBizView({
  instance: { ...instance, biz_type: "reimbursement_batch" },
  bizDetail: {
    batch_no: "RB-1",
    total_amount: 88.8,
    item_count: 2,
    applicant_userid: "u5",
    project_id: 7,
    payment_method: "cash",
    payment_account: null
  },
  ctx
});
assert.strictEqual(batchView.hero.amountLabel, "报销总额");
assert.strictEqual(batchView.hero.title, "人员u5 的报销（2 张单据）");
assert.strictEqual(rowOf(batchView, "付款账户").value, "-");

// 没有业务详情（库房、开票等）：仍要能看到事由，不能白屏
const bareView = buildBizView({ instance: { ...instance, biz_type: "stock_order" }, bizDetail: null, ctx });
assert.strictEqual(bareView.hero.amountText, "");
assert.strictEqual(bareView.hero.title, "付款摘要");
assert.strictEqual(bareView.hero.bizNo, "AP-1");
assert.deepStrictEqual(bareView.rows, []);

// 进行中显示在等谁，结束后不显示；完成时间有才显示
const waiting = buildBizView({
  instance: { ...instance, current_node_key: "n1", current_round: 2 },
  nodes: [
    { node_key: "n1", round: 1, node_name: "旧轮次" },
    { node_key: "n1", round: 2, node_name: "财务审批" }
  ],
  bizDetail: payment,
  ctx
});
assert.strictEqual(waiting.hero.waitText, "等待财务审批");
assert.strictEqual(waiting.hero.statusText, "进行中");
assert.strictEqual(waiting.hero.statusTheme, "primary");
const done = buildBizView({
  instance: { ...instance, status: "approved", completed_at: "2026-11-03T00:00:00Z" },
  bizDetail: payment,
  ctx
});
assert.strictEqual(done.hero.waitText, "");
assert.strictEqual(done.hero.statusTheme, "success");
assert.ok(done.hero.facts.some((fact) => fact.label === "完成于"));

// ── 流程时间线 ──
const flowDetail = {
  nodes: [
    { id: 2, round: 1, sort_order: 2, node_key: "b", node_name: "财务审批", node_type: "sequential", status: "pending" },
    { id: 1, round: 1, sort_order: 1, node_key: "a", node_name: "AI审查", node_type: "ai_gate", status: "completed" }
  ],
  tasks: [
    {
      id: 10,
      node_instance_id: 1,
      assignee_userid: "AI_GATE",
      status: "completed",
      action: "approve",
      comment: "AI审查放行（需人工重点关注）：amount 待核对｜关注点：subject_match：x",
      acted_at: "2026-11-01T01:00:00Z"
    },
    { id: 11, node_instance_id: 2, assignee_userid: "u2", status: "completed", action: "approve", comment: "同意", acted_at: "2026-11-01T02:00:00Z" },
    { id: 12, node_instance_id: 2, assignee_userid: "u3", status: "completed", action: "reject", comment: "金额不对", acted_at: "2026-11-01T03:00:00Z" },
    { id: 13, node_instance_id: 2, assignee_userid: "u4", status: "pending", action: null, comment: null, acted_at: null }
  ]
};
const nodes = buildTimelineNodes(flowDetail, ctx);
assert.deepStrictEqual(
  nodes.map((node) => node.node_name),
  ["AI审查", "财务审批"]
);
const [aiNode, humanNode] = nodes;
// AI 任务只留一句结论：判定有标签，依据在 AI 审查区
assert.strictEqual(aiNode.tasks[0].assigneeLabel, "AI审查");
assert.strictEqual(aiNode.tasks[0].actionLabel, "放行·需人工关注");
assert.strictEqual(aiNode.tasks[0].commentBrief, "金额 待核对");
assert.strictEqual(aiNode.tasks[0].showComment, true);
// 「同意」这类意见不重复显示，真实意见保留
assert.strictEqual(humanNode.tasks[0].showComment, false);
assert.strictEqual(humanNode.tasks[1].commentBrief, "金额不对");
assert.strictEqual(humanNode.tasks[1].showComment, true);
assert.strictEqual(humanNode.tasks[1].actionLabel, "驳回");
// 待处理任务不显示「-」
assert.strictEqual(humanNode.tasks[2].actionLabel, "待处理");
assert.strictEqual(humanNode.tasks[2].actedAtText, "");

// ── 停止原因（口径不变：人工与 AI 取更晚的） ──
const humanReject = {
  instance: { status: "rejected" },
  ai_gate_reviews: []
};
const rejectNodes = [
  { tasks: [{ assignee_userid: "u1", action: "reject", commentText: "金额不对", acted_at: "2026-11-01" }] }
];
assert.strictEqual(extractStopReason(rejectNodes, humanReject), "驳回原因：金额不对");
const aiReturned = {
  instance: { status: "returned" },
  ai_gate_reviews: [
    { decision: "reject", comment: "AI审查不通过：amount 不符", completed_at: "2026-11-02" }
  ]
};
assert.strictEqual(extractStopReason([], aiReturned), "退回原因：AI审查不通过：金额 不符");
const olderAi = {
  instance: { status: "returned" },
  ai_gate_reviews: [{ decision: "reject", comment: "拦截", completed_at: "2026-10-01" }]
};
assert.strictEqual(
  extractStopReason(
    [{ tasks: [{ assignee_userid: "u1", action: "return_initiator", commentText: "补材料", acted_at: "2026-11-01" }] }],
    olderAi
  ),
  "退回原因：补材料"
);
assert.strictEqual(extractStopReason([], { instance: { status: "in_progress" } }), "");

// ── 附件 ──
assert.deepStrictEqual(parseAttachments('[{"key":"a/b.pdf","name":"b.pdf","size":2048},"raw-key",{"x":1},null]'), [
  { file_key: "a/b.pdf", file_name: "b.pdf", file_size: 2048 },
  { file_key: "raw-key", file_name: "未命名附件", file_size: null }
]);
assert.deepStrictEqual(parseAttachments("not json"), []);
assert.deepStrictEqual(parseAttachments(null), []);
assert.deepStrictEqual(
  withFileSizeText([
    { file_key: "a", file_name: "a.pdf", file_size: 2048 },
    { file_key: "b", file_name: "b.png", file_size: "12 KB" },
    { file_key: "c", file_name: "c", file_size: null }
  ]).map((row) => [row.sizeText, row.extLabel]),
  [
    ["2.0 KB", "PDF"],
    ["12 KB", "图片"],
    ["", "文件"]
  ]
);
assert.strictEqual(fileNameExtLabel("工资表.XLSX"), "表格");
assert.strictEqual(fileNameExtLabel("合同.docx"), "文档");
assert.strictEqual(fileNameExtLabel(null), "文件");

// ── 报销单据 ──
const itemRows = buildReimbursementItemRows([
  {
    id: 1,
    envelope_no: "E-1",
    amount: 1200.5,
    ai_reasonability_summary: " amount 合理 ",
    invoice_review_highest_risk: "high",
    attachments: [{ id: 5, file_key: "k", file_name: "票.jpg", file_size: 2048 }]
  },
  { id: 2, envelope_no: "E-2", amount: null, attachments: "bad" }
]);
assert.strictEqual(itemRows[0].amountText, "1,200.50");
assert.strictEqual(itemRows[0].aiReasonabilitySummary, "金额 合理");
assert.strictEqual(itemRows[0].invoiceRiskLabel, "高风险");
assert.strictEqual(itemRows[0].invoiceRiskTheme, "danger");
assert.strictEqual(itemRows[0].attachments[0].sizeText, "2.0 KB");
assert.strictEqual(itemRows[1].amountText, "-");
assert.strictEqual(itemRows[1].aiReasonabilitySummary, "-");
assert.strictEqual(itemRows[1].invoiceRiskLabel, "");
assert.deepStrictEqual(itemRows[1].attachments, []);
assert.deepStrictEqual(buildReimbursementItemRows(null), []);

// ── 北京时间 ──
assert.strictEqual(formatBeijingTime("2026-11-01T16:30:05Z"), "2026-11-02 00:30:05");
assert.strictEqual(formatBeijingTime("不是时间"), "不是时间");
assert.strictEqual(formatBeijingTime(null), "-");

console.log("approval-detail-view.test.js passed");
