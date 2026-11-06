/**
 * 审批详情页的视图模型。WXML 不能调函数，标签、主题、文案都在这里算完；
 * 口径与 Web packages/web/src/views/approval/detail/ 对齐（biz-view / ai-verdict / notices）。
 */
const {
  humanizeAiText,
  normalizeAiFindings,
  parseAiReportJson,
  toAiTaskStatusLabel,
  toFindingDimensionLabel,
  toFindingStatusLabel,
  toFindingStatusTheme,
  toInvoiceRiskLabel,
  toInvoiceRiskTheme
} = require("./ai-review");
const { amountChangeDeltaLabel, amountChangeAttachments } = require("./amount-change-view");
const { formatAmount, toChineseAmount } = require("./amount-cn");
const {
  aiGateHumanReviewActionLabel,
  approvalActionLabel,
  approvalNodeLabel,
  approvalNodeTypeLabel,
  contractDirectionLabel,
  contractTypeLabel,
  fileSizeLabel,
  humanizeBizSummary,
  paymentCategoryLabel,
  paymentMethodLabel
} = require("./enum-labels");
const { localizeErrorMessage } = require("./error-message");

const asText = (value) => (typeof value === "string" ? value.trim() : "");
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const lookup = (table, key, fallback) =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback;

const formatBeijingTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return bj.toISOString().slice(0, 19).replace("T", " ");
};

// ── AI 判定 ──

/** 判定前缀是跨端契约（api ai-gate-result.ts / web ai-review.ts），逻辑不要改 */
const aiDecisionFromComment = (comment) => {
  if (typeof comment !== "string") return null;
  if (comment.indexOf("AI审查不通过") === 0) return "reject";
  if (comment.indexOf("AI审查放行") === 0) return "warn";
  if (comment.indexOf("AI审查通过") === 0) return "pass";
  return null;
};

const AI_DECISION_LABELS = { pass: "建议通过", warn: "放行·需人工关注", reject: "建议拒绝" };
const AI_VERDICT_THEMES = {
  建议通过: "success",
  "放行·需人工关注": "warning",
  建议补充材料: "warning",
  建议拒绝: "danger"
};
const AI_VERDICT_PREFIX = /^AI审查(?:不通过|通过|放行（需人工重点关注）)：/;

const aiOutcomeLabel = (outcome, comment) => {
  // 新版规范化意见带三态前缀（pass/warn/reject），优先于二值 outcome
  const decision = aiDecisionFromComment(comment);
  if (decision) return AI_DECISION_LABELS[decision];
  if (outcome === "approve") return AI_DECISION_LABELS.pass;
  if (outcome === "reject") {
    return /补充|资料|证据|材料/.test(comment || "") ? "建议补充材料" : AI_DECISION_LABELS.reject;
  }
  return "-";
};

/** 旧数据的 summary/comment 可能是裸 JSON 或代码块，拆开取值；不含这三个键的 JSON 按普通文本处理 */
const parseEmbedded = (text) => {
  const parsed = parseAiReportJson(text);
  if (!parsed) return null;
  const hasPayload = asText(parsed.summary) || asText(parsed.comment) || asText(parsed.outcome);
  return hasPayload ? parsed : null;
};

// ── AI 读取范围 ──

const coverageRowText = (item) => {
  const description = asText(item.description);
  if (description) return description;
  const name = asText(item.name) || "附件";
  return item.pages_total && item.pages_read !== null && item.pages_read !== undefined
    ? `《${name}》共 ${item.pages_total} 页，已读 ${item.pages_read} 页`
    : `《${name}》未读完`;
};

/**
 * @param {unknown} coverage ai_gate_reviews[].evidence_coverage，旧数据没有
 * @returns {null | { incomplete: true, title: string, rows: Array } | { incomplete: false, text: string }}
 *   只有明确 complete 时才有结果：缺字段既不能当读完，也不能当没读完
 */
const buildCoverageView = (coverage) => {
  if (!isPlainObject(coverage)) return null;
  const items = Array.isArray(coverage.items) ? coverage.items.filter(isPlainObject) : [];
  if (coverage.complete === false) {
    const unread = items.filter((item) => item.status !== "complete").map(coverageRowText);
    const texts = unread.length > 0 ? unread : [asText(coverage.summary) || "未读取范围未知，请对照原件核实"];
    return {
      incomplete: true,
      title: "AI 没有读完全部附件，结论仅供参考，请对照原件核实",
      rows: texts.map((text, index) => ({ key: `coverage-${index}`, text }))
    };
  }
  if (coverage.complete === true) {
    const detail = items.map((item) => asText(item.description)).filter(Boolean).join("；");
    return { incomplete: false, text: detail ? `AI 已读完全部附件（${detail}）` : "AI 已读完全部附件" };
  }
  return null;
};

// ── AI 审查区 ──

const toFindingRow = (finding, index) => ({
  key: `finding-${index}`,
  rawStatus: finding.status,
  dimensionLabel: toFindingDimensionLabel(finding.dimension),
  statusLabel: toFindingStatusLabel(finding.status),
  statusTheme: toFindingStatusTheme(finding.status),
  detail: humanizeAiText(finding.detail),
  evidence: humanizeAiText(finding.evidence)
});

const REVIEW_STATE_VIEWS = {
  running: {
    verdictLabel: "审查中",
    verdictTheme: "warning",
    summary: "AI 正在读取附件并审查，不影响你现在审批。"
  },
  failed: {
    verdictLabel: "审查失败",
    verdictTheme: "danger",
    summary: "AI 这次没有得出结论，请人工审核。"
  },
  cancelled: {
    verdictLabel: toAiTaskStatusLabel("cancelled"),
    verdictTheme: "default",
    summary: "这次 AI 审查已撤回。"
  }
};
const REVIEW_STATES = {
  pending: "running",
  assigned: "running",
  running: "running",
  failed: "failed",
  timeout: "failed",
  cancelled: "cancelled"
};

const toReviewView = (row, nodeNames, formatTime) => {
  const state = lookup(REVIEW_STATES, row.status, "done");
  const embedded = parseEmbedded(row.summary);
  const comment = asText(row.comment) || asText(embedded && embedded.comment);
  const plainSummary = embedded ? asText(embedded.summary) : asText(row.summary);
  const outcome = row.outcome || (embedded && embedded.outcome) || null;
  const decision = row.decision || aiDecisionFromComment(comment);
  const verdictLabel = lookup(AI_DECISION_LABELS, decision, "") || aiOutcomeLabel(outcome, comment);
  const summary = humanizeAiText(plainSummary || comment) || "-";
  const commentText = humanizeAiText(comment);

  const findings = normalizeAiFindings(row.findings).map(toFindingRow);
  const coverage = buildCoverageView(row.evidence_coverage);
  const errorMessage = asText(row.error_message);
  const nodeKey = String(row.node_key || "");

  return {
    taskId: row.task_id,
    state,
    verdictLabel,
    verdictTheme: lookup(AI_VERDICT_THEMES, verdictLabel, "default"),
    summary,
    // 旧数据没有 findings：comment 是唯一的依据，不能丢
    commentFallback: findings.length === 0 && commentText !== summary ? commentText : "",
    errorText: errorMessage ? localizeErrorMessage(errorMessage, 500) : "",
    coverage,
    // 失败项排在关注项前面
    concerns: findings
      .filter((item) => item.rawStatus !== "pass")
      .sort((a, b) => Number(b.rawStatus === "fail") - Number(a.rawStatus === "fail")),
    passed: findings.filter((item) => item.rawStatus === "pass"),
    recommendations: (Array.isArray(row.recommendations) ? row.recommendations : [])
      .filter((text) => asText(text))
      .map((text, index) => ({ key: `rec-${index}`, text: humanizeAiText(asText(text)) })),
    nodeLabel: approvalNodeLabel({
      node_name: lookup(nodeNames, nodeKey, ""),
      node_type: "ai_gate"
    }),
    completedAtText: formatTime(row.completed_at),
    ...lookup(REVIEW_STATE_VIEWS, state, {})
  };
};

/**
 * @param {Array} reviews ai_gate_reviews，按 created_at 倒序，首条是最新结论
 * @param {Record<string, string>} nodeNames node_key → 节点中文名，node_key 本身不进界面
 * @param {(value: unknown) => string} formatTime
 */
const buildAiPanel = (reviews, nodeNames, formatTime) => {
  const views = (Array.isArray(reviews) ? reviews : [])
    .filter(isPlainObject)
    .map((row) => toReviewView(row, nodeNames || {}, formatTime));
  return {
    latest: views[0] || null,
    earlier: views.slice(1).map((view, index) => ({
      key: `earlier-${index}`,
      verdictLabel: view.verdictLabel,
      verdictTheme: view.verdictTheme,
      summary: view.summary,
      nodeLabel: view.nodeLabel,
      completedAtText: view.completedAtText,
      coverageIncomplete: Boolean(view.coverage && view.coverage.incomplete)
    }))
  };
};

const buildNodeNameMap = (detail) =>
  (Array.isArray(detail && detail.nodes) ? detail.nodes : []).reduce((acc, node) => {
    const key = String((node && node.node_key) || "");
    return key && node.node_name ? { ...acc, [key]: node.node_name } : acc;
  }, {});

// ── 业务视图 ──

const REMARK_EDIT_LINE = /^\[超管修改 ([^\]]+)\] ([^：:]+)[：:](.*)$/;
const REMARK_VOID_LINE = /^\[VOID ([^\]]+)\] ([^：:]+)(?:[：:](.*))?$/;
const REMARK_REACTIVATE_LINE = /^\[REACTIVATE ([^\]]+)\] ([^：:]+)/;

const parseRemarkLog = (line) => {
  const text = line.trim();
  const edit = text.match(REMARK_EDIT_LINE);
  if (edit) return { at: edit[1], by: edit[2].trim(), note: edit[3].trim() };
  const voided = text.match(REMARK_VOID_LINE);
  if (voided) {
    const reason = (voided[3] || "").trim();
    return { at: voided[1], by: voided[2].trim(), note: reason ? `作废付款：${reason}` : "作废付款" };
  }
  const reactivated = text.match(REMARK_REACTIVATE_LINE);
  return reactivated ? { at: reactivated[1], by: reactivated[2].trim(), note: "重新激活" } : null;
};

/** 把备注里系统追加的日志行（超管修改、作废、激活）分离出来，备注区只显示发起人写的内容 */
const splitRemark = (remark) => {
  const lines = String(remark || "").split("\n");
  const logs = lines.map(parseRemarkLog);
  return {
    text: lines.filter((_, index) => !logs[index]).join("\n").trim(),
    edits: logs.filter(Boolean)
  };
};

/** 付款作废写在备注里的记录，取最后一条（作废后可能被重新激活再作废） */
const parseVoidRecord = (remark) => {
  const records = String(remark || "")
    .split("\n")
    .map((line) => line.trim().match(REMARK_VOID_LINE))
    .filter(Boolean);
  const last = records[records.length - 1];
  return last ? { at: last[1], by: last[2].trim(), reason: (last[3] || "").trim() } : null;
};

const INSTANCE_STATUS_VIEWS = {
  pending: ["待处理", "warning"],
  in_progress: ["进行中", "primary"],
  approved: ["已通过", "success"],
  rejected: ["已驳回", "danger"],
  returned: ["已退回", "warning"],
  cancelled: ["已取消", "default"],
  withdrawn: ["已撤回", "default"],
  completed: ["已完成", "success"],
  transferred: ["已转签", "default"],
  skipped: ["已跳过", "default"]
};
const statusLabel = (status) => lookup(INSTANCE_STATUS_VIEWS, status, ["未知"])[0];
const statusTheme = (status) => lookup(INSTANCE_STATUS_VIEWS, status, ["", "default"])[1];

const BIZ_TYPE_LABELS = {
  outbound_contract: "对外合同审批",
  inbound_contract: "收款合同审批",
  payment_request: "付款审批",
  reimbursement_batch: "报销审批",
  stock_order: "库房出入库审批",
  warehouse_asset_work_order: "库房工单审批",
  invoice_request: "开票审批",
  receipt_refund: "收款退款审批",
  contract_amount_change: "合同金额变更"
};

const row = (label, value, multiline = false) => ({ label, value: value || "-", multiline });

/** 支付方案可以后补，没选的时候要说清楚，不能显示成短横线让人以为没这一项。 */
const NOT_SPECIFIED = "尚未指定";

const settledRow = (contract) =>
  contract && contract.direction === "inbound"
    ? row("已收金额", formatAmount(contract.received_amount))
    : row("已付金额", formatAmount(contract && contract.paid_amount));

const buildPaymentView = (bizDetail, ctx) => {
  const { contract, payee } = bizDetail;
  const contractText = contract
    ? `${contract.contract_no} - ${contract.counterparty}`
    : bizDetail.contract_id
      ? "未匹配"
      : "无合同 / 无需合同";
  const remark = splitRemark(bizDetail.remark);
  return {
    amount: bizDetail.amount,
    amountLabel: "申请金额",
    title: bizDetail.content,
    bizNo: bizDetail.serial_no,
    keyFacts: [
      {
        label: "付款单位",
        value: bizDetail.payment_entity_id ? ctx.entity(bizDetail.payment_entity_id) : NOT_SPECIFIED
      },
      { label: "收款方", value: (payee && payee.name) || "-" },
      { label: "所属项目", value: ctx.project(bizDetail.project_id) }
    ],
    detailTitle: "付款明细",
    edits: remark.edits,
    rows: [
      row("关联合同", contractText),
      row("付款类别", paymentCategoryLabel(bizDetail.category, "未知")),
      row("收款账号", payee ? `${payee.bank_name} / ${payee.bank_account}` : "-"),
      row("付款账户", bizDetail.payment_account || NOT_SPECIFIED),
      row("预计付款日", bizDetail.expected_payment_date),
      row("付款方式", paymentMethodLabel(bizDetail.payment_method, "-")),
      row("备注", remark.text, true)
    ]
  };
};

const buildContractView = (bizDetail, ctx) => {
  const typeLabel = contractTypeLabel(bizDetail.contract_type, "未知");
  const remark = splitRemark(bizDetail.remark);
  return {
    amount: bizDetail.total_amount,
    amountLabel: "合同金额",
    title: `${bizDetail.counterparty || "-"} · ${typeLabel}`,
    bizNo: bizDetail.contract_no,
    keyFacts: [
      { label: "我方主体", value: ctx.entity(bizDetail.entity_id) },
      { label: "所属项目", value: ctx.project(bizDetail.project_id) }
    ],
    detailTitle: "合同明细",
    edits: remark.edits,
    rows: [
      row("方向", contractDirectionLabel(bizDetail.direction, "未知")),
      row("对方单位", bizDetail.counterparty),
      row("合同类型", typeLabel),
      row("经办人", ctx.user(bizDetail.handler_userid)),
      row("合同日期", bizDetail.contract_date),
      settledRow(bizDetail),
      row("备注", remark.text, true)
    ]
  };
};

const buildAmountChangeView = (bizDetail, ctx) => {
  const { contract } = bizDetail;
  return {
    amount: bizDetail.new_amount,
    amountLabel: "新合同金额",
    title: contract ? `${contract.counterparty} 合同金额变更` : "",
    bizNo: contract ? contract.contract_no : "",
    keyFacts: [{ label: "所属项目", value: contract ? ctx.project(contract.project_id) : "-" }],
    detailTitle: "变更明细",
    edits: [],
    rows: [
      row("原合同金额", `${formatAmount(bizDetail.old_amount)}（${toChineseAmount(bizDetail.old_amount)}）`),
      row("变更差额", amountChangeDeltaLabel(bizDetail.old_amount, bizDetail.new_amount)),
      settledRow(contract),
      row("方向", contract ? contractDirectionLabel(contract.direction, "未知") : "-"),
      row("申请人", ctx.user(bizDetail.applicant_userid)),
      row("变更缘由", bizDetail.reason, true),
      ...(amountChangeAttachments(bizDetail).length === 0 ? [row("附件", "申请人未上传附件")] : [])
    ]
  };
};

const buildReimbursementView = (bizDetail, ctx) => ({
  amount: bizDetail.total_amount,
  amountLabel: "报销总额",
  title: `${ctx.user(bizDetail.applicant_userid)} 的报销（${bizDetail.item_count} 张单据）`,
  bizNo: bizDetail.batch_no,
  keyFacts: [
    {
      label: "付款单位",
      value:
        (bizDetail.payment_entity && bizDetail.payment_entity.entity_name) ||
        (bizDetail.payment_entity_id ? ctx.entity(bizDetail.payment_entity_id) : NOT_SPECIFIED)
    },
    { label: "所属项目", value: ctx.project(bizDetail.project_id) }
  ],
  detailTitle: "报销明细",
  edits: [],
  rows: [
    row("支付方式", paymentMethodLabel(bizDetail.payment_method, "-")),
    row("付款账户", bizDetail.payment_account || NOT_SPECIFIED)
  ]
});

const BIZ_VIEW_BUILDERS = {
  payment_request: buildPaymentView,
  outbound_contract: buildContractView,
  inbound_contract: buildContractView,
  contract_amount_change: buildAmountChangeView,
  reimbursement_batch: buildReimbursementView
};

const hasAmount = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

/** 审批进行中时当前卡在哪个节点；其余状态返回空串 */
const buildWaitText = (instance, nodes) => {
  if (!instance || instance.status !== "in_progress") return "";
  const currentNode = (Array.isArray(nodes) ? nodes : []).find(
    (node) =>
      node &&
      String(node.node_key || "") === String(instance.current_node_key || "") &&
      Number(node.round || 0) === Number(instance.current_round || 0)
  );
  return currentNode ? `等待${approvalNodeLabel(currentNode)}` : "";
};

const buildRemarkEdits = (edits, ctx) =>
  (Array.isArray(edits) ? edits : []).map((edit, index) => ({
    key: `edit-${index}`,
    atText: ctx.formatTime(edit.at),
    byText: ctx.user(edit.by),
    note: edit.note
  }));

/**
 * 页面头部与明细，各业务统一成同一个形状。库房、开票等没有业务详情的单据也要能看到事由。
 * @param {object} params
 * @param {object} params.instance 审批实例
 * @param {Array} [params.nodes] 节点，用来显示在等谁
 * @param {object | null} params.bizDetail 业务详情，大写按金额现算，不读 amount_cn
 * @param {{ user: Function, project: Function, entity: Function, formatTime: Function }} params.ctx
 */
const buildBizView = ({ instance, nodes, bizDetail, ctx }) => {
  const builder = bizDetail ? lookup(BIZ_VIEW_BUILDERS, instance.biz_type, null) : null;
  const biz = builder ? builder(bizDetail, ctx) : null;
  const summary = humanizeBizSummary(instance.biz_summary) || "";
  const title = (biz && biz.title) || summary || "-";

  return {
    hero: {
      statusText: statusLabel(instance.status),
      statusTheme: statusTheme(instance.status),
      waitText: buildWaitText(instance, nodes),
      bizTypeLabel: lookup(BIZ_TYPE_LABELS, instance.biz_type, "未知"),
      bizNo: (biz && biz.bizNo) || instance.instance_no || "-",
      amountLabel: biz ? biz.amountLabel : "",
      amountText: biz && hasAmount(biz.amount) ? formatAmount(biz.amount) : "",
      amountUpper: biz && hasAmount(biz.amount) ? toChineseAmount(biz.amount) : "",
      title,
      facts: [
        ...(biz ? biz.keyFacts : []),
        { label: "发起人", value: ctx.user(instance.initiator_userid) },
        { label: "提交于", value: ctx.formatTime(instance.submitted_at) },
        ...(instance.completed_at ? [{ label: "完成于", value: ctx.formatTime(instance.completed_at) }] : [])
      ]
    },
    detailTitle: biz ? biz.detailTitle : "",
    rows: biz
      ? [
          ...biz.rows,
          ...(summary && summary !== title ? [row("审批摘要", summary, true)] : []),
          row("审批单号", instance.instance_no)
        ]
      : [],
    remarkEdits: buildRemarkEdits(biz ? biz.edits : [], ctx)
  };
};

const buildReimbursementItemRows = (items) =>
  (Array.isArray(items) ? items : []).filter(isPlainObject).map((item) => ({
    ...item,
    amountText: formatAmount(item.amount),
    aiReasonabilitySummary: humanizeAiText(asText(item.ai_reasonability_summary)) || "-",
    invoiceRiskLabel: toInvoiceRiskLabel(item.invoice_review_highest_risk),
    invoiceRiskTheme: toInvoiceRiskTheme(item.invoice_review_highest_risk),
    attachments: withFileSizeText(Array.isArray(item.attachments) ? item.attachments : [])
  }));

// ── 流程时间线 ──

const REDUNDANT_COMMENTS = ["同意", "通过", "已阅", "ok", "OK"];

/** 流程已不在这一轮跑了：实例结束、退回、撤回，或者这是旧轮次 */
const isRoundClosed = (node, instance) => {
  if (!instance || !instance.status) return false;
  return instance.status !== "in_progress" || Number(node.round) < Number(instance.current_round);
};

/** 最后一个决定是驳回：引擎把驳回节点也落成 completed，不能显示成已完成 */
const isNodeRejected = (tasks) => {
  const decisions = tasks.filter((task) => task && (task.action === "approve" || task.action === "reject"));
  const last = decisions[decisions.length - 1];
  return Boolean(last) && last.action === "reject";
};

const resolveNodeStatus = (node, tasks, instance) => {
  if (node.status === "returned") return ["已退回", "warning"];
  if (node.status === "completed" && isNodeRejected(tasks)) return ["已驳回", "danger"];
  if (isRoundClosed(node, instance)) {
    if (node.status === "in_progress" || node.status === "cancelled") return ["已中止", "default"];
    if (node.status === "pending") return ["未执行", "default"];
  }
  return [statusLabel(node.status), statusTheme(node.status)];
};

const toTaskView = (task, node, aiFallback, ctx) => {
  const isAi = task.assignee_userid === "AI_GATE";
  const embedded = parseEmbedded(task.comment);
  const rawComment =
    asText(embedded && embedded.comment) || asText(task.comment) || (aiFallback && aiFallback.comment) || "";
  // AI 任务只留一句结论：判定已由标签表达，依据在 AI 审查区
  const commentBrief = isAi
    ? humanizeAiText(rawComment.replace(AI_VERDICT_PREFIX, "").split("｜")[0].trim())
    : rawComment;
  const baseLabel = isAi
    ? task.status === "pending"
      ? "审查中"
      : aiOutcomeLabel((embedded && embedded.outcome) || task.action, rawComment)
    : task.action
      ? approvalActionLabel(task.action)
      : task.status === "cancelled"
        ? "未处理" // 流程已结束，没轮到这个人
        : statusLabel(task.status);
  return {
    ...task,
    // AI_GATE 不在通讯录里，走 ctx.user 会显示成「未匹配」
    assigneeLabel: isAi ? "AI审查" : ctx.user(task.assignee_userid),
    actionLabel: aiGateHumanReviewActionLabel(node.node_type, task, baseLabel),
    // 仅 AI 任务的意见做字段名汉化，人工意见原样保留
    commentText: (isAi ? humanizeAiText(rawComment) : rawComment) || "-",
    commentBrief,
    // 通过时「同意」这类字样和动作标签重复，其他动作的意见都要显示
    showComment:
      Boolean(commentBrief) && (isAi || task.action !== "approve" || REDUNDANT_COMMENTS.indexOf(commentBrief) < 0),
    actedAtText: task.acted_at ? ctx.formatTime(task.acted_at) : ""
  };
};

const buildTimelineNodes = (detail, ctx) => {
  const nodes = Array.isArray(detail && detail.nodes) ? detail.nodes : [];
  const tasks = Array.isArray(detail && detail.tasks) ? detail.tasks : [];
  const reviews = Array.isArray(detail && detail.ai_gate_reviews) ? detail.ai_gate_reviews : [];
  return nodes
    .slice()
    .sort((a, b) => (a.round !== b.round ? a.round - b.round : a.sort_order - b.sort_order))
    .map((node) => {
      const aiFallback = reviews.find((review) => review && review.node_key === node.node_key);
      const nodeTasks = tasks.filter((task) => task && task.node_instance_id === node.id);
      const [nodeStatusLabel, nodeStatusTheme] = resolveNodeStatus(node, nodeTasks, detail && detail.instance);
      return {
        ...node,
        statusLabel: nodeStatusLabel,
        statusTheme: nodeStatusTheme,
        nodeTypeLabel: approvalNodeTypeLabel(node.node_type, ""),
        tasks: nodeTasks.map((task) => toTaskView(task, node, aiFallback, ctx))
      };
    });
};

/** 这一轮是怎么结束的。退回发起人或 AI 拦截会写节点和原因 */
const describeRoundEnd = (nodes) => {
  const withTasks = nodes.flatMap((node) => (node.tasks || []).map((task) => ({ node, task })));
  const returned = withTasks.filter(({ task }) => task.action === "return_initiator").pop();
  if (returned) {
    const comment = asText(returned.task.commentText);
    return `${returned.node.node_name} ${returned.task.assigneeLabel} 退回：${comment && comment !== "-" ? comment : "未留意见"}`;
  }
  const aiReturned = withTasks
    .filter(({ node, task }) => node.status === "returned" && task.assignee_userid === "AI_GATE" && task.action === "reject")
    .pop();
  if (aiReturned) return `${aiReturned.node.node_name} AI 审查 退回：${aiReturned.task.commentBrief || "未留意见"}`;
  if (nodes.some((node) => node.status === "in_progress" || node.status === "cancelled")) {
    return "发起人撤回后重新提交";
  }
  return "这一轮没有走完";
};

/**
 * 退回或撤回后重新提交会新开一轮，同名节点再来一遍。当前轮单独显示，
 * 前面的轮次折叠，并说明每一轮是怎么结束的，否则看起来像流程走重了。
 * @param {Array} nodes buildTimelineNodes 的结果，已按轮次升序
 * @param {object} detail 审批详情
 */
const groupTimelineRounds = (nodes, detail) => {
  const list = Array.isArray(nodes) ? nodes : [];
  const instance = (detail && detail.instance) || {};
  const rounds = list.map((node) => Number(node.round) || 0);
  const current = Number(instance.current_round) || Math.max(0, ...rounds);
  const earlierRounds = Array.from(new Set(rounds))
    .filter((round) => round > 0 && round < current)
    .sort((a, b) => b - a);
  const earlierSet = new Set(earlierRounds);
  return {
    currentNodes: list.filter((node) => !earlierSet.has(Number(node.round) || 0)),
    roundLabel: current > 1 ? `第 ${current} 轮` : "",
    earlier: earlierRounds.map((round) => {
      const roundNodes = list.filter((node) => Number(node.round) === round);
      return {
        round,
        title: `第 ${round} 轮`,
        endText: describeRoundEnd(roundNodes),
        nodes: roundNodes
      };
    })
  };
};

const FLOW_STOPPED_STATUSES = ["rejected", "returned", "cancelled", "withdrawn"];

/** 流程停下来时默认展开，停在哪、为什么不能藏在折叠层里 */
const isFlowStopped = (status) => FLOW_STOPPED_STATUSES.indexOf(status) >= 0;

/**
 * 流程区默认折叠，这些情况要默认展开：流程停下来了，或者有人写了实际意见
 * （如通过时写「付款后补发票」），意见不能藏在折叠层里。
 * @param {string} status 实例状态
 * @param {Array} nodes 当前轮的节点
 */
const shouldExpandFlow = (status, nodes) =>
  isFlowStopped(status) ||
  (Array.isArray(nodes) ? nodes : []).some((node) =>
    (node.tasks || []).some((task) => task.assignee_userid !== "AI_GATE" && task.showComment)
  );

const describeClosedInstance = (detail, bizRemark, ctx) => {
  const withdrawn = detail.instance.status === "withdrawn";
  const wanted = withdrawn ? "withdraw" : "cancel";
  const actions = (Array.isArray(detail.initiator_actions) ? detail.initiator_actions : []).filter(
    (item) => item && item.action === wanted
  );
  const action = actions[actions.length - 1] || null;
  const voided = withdrawn ? null : parseVoidRecord(bizRemark);
  const title = withdrawn
    ? "发起人已撤回这笔审批"
    : voided
      ? "付款单已作废，这笔审批随之取消"
      : "这笔审批已取消";
  const by = (action && action.userid) || (voided && voided.by) || "";
  const who = by && ctx ? ctx.user(by) : "";
  const reason = asText(action && action.comment) || (voided && voided.reason) || "";
  if (!who) return `${title}。${reason || "未填写原因"}`;
  return reason ? `${title}。${who}：${reason}` : `${title}。${who}，未填写原因`;
};

/**
 * 驳回/退回原因：rejected 找人工驳回意见，returned 找人工退回意见；
 * 两者都命不中时回退 AI 关卡拦截结论（分级拦截后 AI 拦截走 returned，
 * 任务 action 仍是 reject、理由在 comment）。人工与 AI 都有时取时间更晚的，
 * 避免把上一轮的旧 AI 结论错标成本次退回原因。
 */
const extractStopReason = (timelineNodes, detail, bizRemark, ctx) => {
  const status = detail && detail.instance ? detail.instance.status : "";
  if (status === "cancelled" || status === "withdrawn") return describeClosedInstance(detail, bizRemark, ctx);
  if (status !== "rejected" && status !== "returned") return "";
  const wantActions = status === "rejected" ? ["reject"] : ["return_initiator", "return_prev", "return_to"];

  // 节点已按 round+sort_order 升序，最后一条命中即最新人工意见
  const humanTasks = (Array.isArray(timelineNodes) ? timelineNodes : [])
    .flatMap((node) => (node && Array.isArray(node.tasks) ? node.tasks : []))
    .filter(
      (task) =>
        task &&
        task.assignee_userid !== "AI_GATE" &&
        wantActions.indexOf(task.action) >= 0 &&
        asText(task.commentText) &&
        asText(task.commentText) !== "-"
    );
  const human = humanTasks[humanTasks.length - 1] || null;
  const humanText = human ? asText(human.commentText) : "";
  const humanAt = (human && human.acted_at) || "";

  // ai_gate_reviews 按 created_at 倒序，首个拦截结论即最新
  const reviews = detail && Array.isArray(detail.ai_gate_reviews) ? detail.ai_gate_reviews : [];
  const aiReject = reviews.find(
    (review) =>
      review &&
      asText(review.comment) &&
      (review.decision === "reject" || aiDecisionFromComment(asText(review.comment)) === "reject")
  );
  const aiText = aiReject ? asText(aiReject.comment) : "";
  const aiAt = (aiReject && aiReject.completed_at) || "";

  const fromAi = Boolean(aiText) && (!humanText || Boolean(aiAt && humanAt && aiAt > humanAt));
  const text = fromAi ? aiText : humanText;
  if (!text) return "";

  const title = status === "returned" ? "退回原因" : "驳回原因";
  // AI 结论自带「AI审查不通过：…」前缀时不再重复标注来源
  const byPrefix = fromAi && text.indexOf("AI审查") !== 0 ? "AI审查：" : "";
  return `${title}：${byPrefix}${fromAi ? humanizeAiText(text) || text : text}`;
};

// ── 附件 ──

const parseAttachments = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        // 字符串形态的附件只有 R2 key（ASCII 串），不能当文件名上屏
        if (typeof item === "string") return { file_key: item, file_name: "未命名附件", file_size: null };
        if (!isPlainObject(item)) return null;
        const key = item.file_key || item.key;
        if (!key) return null;
        return {
          file_key: key,
          file_name: item.file_name || item.name || "未命名附件",
          file_size: item.file_size || item.size || null
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const FILE_EXT_LABELS = [
  [/\.pdf$/i, "PDF"],
  [/\.(png|jpe?g|webp|gif|bmp|heic)$/i, "图片"],
  [/\.(xlsx?|csv)$/i, "表格"],
  [/\.docx?$/i, "文档"]
];

const fileNameExtLabel = (fileName) => {
  const name = typeof fileName === "string" ? fileName : "";
  const hit = FILE_EXT_LABELS.find(([pattern]) => pattern.test(name));
  return hit ? hit[1] : "文件";
};

/** file_size 有的是字节数，有的是已格式化的文案（合同金额变更） */
const toSizeText = (size) => {
  if (size === null || size === undefined || size === "") return "";
  return Number.isFinite(Number(size)) ? fileSizeLabel(size) : String(size);
};

const withFileSizeText = (list) =>
  list.map((item) => ({
    ...item,
    sizeText: toSizeText(item.file_size),
    extLabel: fileNameExtLabel(item.file_name)
  }));

module.exports = {
  formatBeijingTime,
  aiDecisionFromComment,
  splitRemark,
  buildCoverageView,
  buildAiPanel,
  buildNodeNameMap,
  buildPaymentView,
  buildContractView,
  buildBizView,
  buildWaitText,
  buildRemarkEdits,
  buildReimbursementItemRows,
  buildTimelineNodes,
  groupTimelineRounds,
  isFlowStopped,
  shouldExpandFlow,
  extractStopReason,
  parseAttachments,
  withFileSizeText,
  fileNameExtLabel
};
