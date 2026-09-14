const assert = require("assert");

const {
  statusLabel,
  contractTypeLabel,
  contractDirectionLabel,
  amountChangeTypeLabel,
  paymentMethodLabel,
  paymentCategoryLabel,
  attachmentTypeLabel,
  refundModeLabel,
  riskLevelLabel,
  severityLabel,
  duplicateMatchTypeLabel,
  docTypeLabel,
  orderTypeLabel,
  workOrderTypeLabel,
  priorityLabel,
  approvalActionLabel,
  aiGateHumanReviewActionLabel,
  approvalNodeLabel,
  roleLabel,
  bizTypeLabel,
  fileSizeLabel
} = require("./enum-labels");

const CJK = /[一-鿿]/;
const assertChinese = (value, label) => {
  assert.ok(CJK.test(value), `${label} 必须是中文，实际：${value}`);
  assert.ok(!/[A-Za-z]{2,}/.test(value), `${label} 不应残留英文，实际：${value}`);
};

// ── 命中映射 ──
assert.strictEqual(statusLabel("pending_approval"), "待审批");
assert.strictEqual(contractTypeLabel("machinery"), "机械");
assert.strictEqual(contractDirectionLabel("inbound"), "对外收款合同");
assert.strictEqual(amountChangeTypeLabel("increase"), "增加");
assert.strictEqual(paymentMethodLabel("bank_transfer"), "对公转账");
assert.strictEqual(paymentCategoryLabel("labor_fee"), "劳务费");
assert.strictEqual(attachmentTypeLabel("invoice"), "发票");
assert.strictEqual(refundModeLabel("full"), "全额退款");
assert.strictEqual(riskLevelLabel("high"), "高风险");
assert.strictEqual(severityLabel("critical"), "严重");
assert.strictEqual(duplicateMatchTypeLabel("qr_hash"), "发票二维码重复");
assert.strictEqual(docTypeLabel("manual"), "操作手册");
assert.strictEqual(orderTypeLabel("transfer"), "调拨");
assert.strictEqual(workOrderTypeLabel("servicing"), "保养");
assert.strictEqual(priorityLabel("urgent"), "紧急");
assert.strictEqual(approvalActionLabel("return_prev"), "退回上一节点");
assert.strictEqual(roleLabel("site_manager"), "项目负责人");

// ── 后端字典字段本身就是中文时原样保留 ──
assert.strictEqual(paymentMethodLabel("对公转账"), "对公转账");
assert.strictEqual(paymentCategoryLabel("行政费"), "行政费");
assert.strictEqual(statusLabel("已归档"), "已归档");

// ── 核心契约：未收录的英文码绝不透给用户 ──
assertChinese(statusLabel("brand_new_state"), "未收录状态");
assertChinese(contractTypeLabel("weird_type"), "未收录合同类型");
assertChinese(refundModeLabel("half"), "未收录退款方式");
assertChinese(orderTypeLabel("teleport"), "未收录单据类型");
assert.strictEqual(attachmentTypeLabel("whatever"), "其他");
assert.strictEqual(docTypeLabel("whatever"), "其他");
assert.strictEqual(severityLabel("whatever"), "提示");
assert.strictEqual(priorityLabel("whatever"), "普通");

// 空值走各自的兜底
assert.strictEqual(statusLabel(""), "未知");
assert.strictEqual(statusLabel(null), "未知");
assert.strictEqual(statusLabel(undefined, "-"), "-");

// 原型键不能命中 Object.prototype 上的函数
assert.strictEqual(statusLabel("constructor"), "未知");
assert.strictEqual(statusLabel("toString"), "未知");

// ── 审批节点：node_key 永远不进界面 ──
assert.strictEqual(approvalNodeLabel({ node_name: "财务复核" }), "财务复核");
assert.strictEqual(approvalNodeLabel({ node_key: "ai_gate_contract", node_type: "ai_gate" }), "AI 关卡");
assert.strictEqual(approvalNodeLabel({ node_key: "n1" }), "审批节点");
assert.strictEqual(approvalNodeLabel(null), "审批节点");
// 节点名是英文时也不透传
assert.strictEqual(approvalNodeLabel({ node_name: "Finance Review" }), "审批节点");

// ── 文件大小：不再出现 bytes ──
assert.strictEqual(fileSizeLabel(900), "900 字节");
assert.strictEqual(fileSizeLabel(2048), "2.0 KB");
assert.strictEqual(fileSizeLabel(5 * 1024 * 1024), "5.0 MB");
assert.strictEqual(fileSizeLabel(0), "");
assert.strictEqual(fileSizeLabel(null), "");
assert.strictEqual(fileSizeLabel("abc"), "");

// ── 审批业务类型：通知/待办卡片不能露出 biz_type 英文码 ──
assert.strictEqual(bizTypeLabel("reimbursement_batch"), "报销审批");
assert.strictEqual(bizTypeLabel("warehouse_asset_work_order"), "库房工单审批");
assertChinese(bizTypeLabel("brand_new_biz"), "未收录业务类型");
assert.strictEqual(bizTypeLabel(""), "审批事项");

console.log("enum-labels.test.js passed");

// AI 拦截转人工：关卡节点上真人任务的动作文案（2026-09-13 设计）
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "Boss", status: "pending" }, "-"),
  "AI 拦截，等待人工复核"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "Boss", status: "completed", action: "approve" }, "通过"),
  "人工复核 · 通过"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("ai_gate", { assignee_userid: "AI_GATE", status: "completed" }, "AI通过"),
  "AI通过"
);
assert.strictEqual(
  aiGateHumanReviewActionLabel("sequential", { assignee_userid: "Boss", status: "pending" }, "-"),
  "-"
);
console.log("enum-labels.test.js (ai-gate human review) passed");
