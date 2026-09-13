const assert = require("assert");

const {
  canEditReturnedApproval,
  getReturnedApprovalEditRoute,
  RETURNED_APPROVAL_EDIT_BIZ_TYPES
} = require("./returned-approval");

const expectedBizTypes = [
  "payment_request",
  "reimbursement_batch",
  "stock_order",
  "warehouse_asset_work_order",
  "outbound_contract",
  "inbound_contract",
  "invoice_request"
];

assert.deepStrictEqual(RETURNED_APPROVAL_EDIT_BIZ_TYPES.slice().sort(), expectedBizTypes.slice().sort());
assert.ok(
  RETURNED_APPROVAL_EDIT_BIZ_TYPES.includes("payment_request"),
  "RETURNED_APPROVAL_EDIT_BIZ_TYPES should contain payment_request"
);

for (const bizType of expectedBizTypes) {
  const route = getReturnedApprovalEditRoute({
    approvalId: 19,
    bizType,
    bizId: 88
  });
  assert.strictEqual(
    route,
    `/pages/returned-approval-edit/index?approvalId=19&bizType=${encodeURIComponent(bizType)}&bizId=88`
  );
}

assert.strictEqual(
  canEditReturnedApproval(
    { status: "returned", initiator_userid: "user-a", biz_type: "payment_request", biz_id: 1, id: 2 },
    "user-a"
  ),
  true
);

assert.strictEqual(
  canEditReturnedApproval(
    { status: "in_progress", initiator_userid: "user-a", biz_type: "payment_request", biz_id: 1, id: 2 },
    "user-a"
  ),
  false
);

assert.strictEqual(
  canEditReturnedApproval(
    { status: "returned", initiator_userid: "user-a", biz_type: "unknown", biz_id: 1, id: 2 },
    "user-a"
  ),
  false
);

// ── 业务单据已作废时，即便实例仍是 returned 也不能再编辑重提 ──
// （2026-09-13 SP-20260913-0007：付款被超管作废后审批实例仍留在 returned，
//   审批详情继续给出「编辑并重新提交」入口，提交时后端报付款已作废。）
const { isBizRecordCancelled } = require("./returned-approval");

assert.strictEqual(isBizRecordCancelled(null), false, "无业务详情时不应判定为已作废");
assert.strictEqual(isBizRecordCancelled(undefined), false);
assert.strictEqual(isBizRecordCancelled({}), false);
assert.strictEqual(isBizRecordCancelled({ status: "draft" }), false);
assert.strictEqual(isBizRecordCancelled({ status: "pending_approval" }), false);
assert.strictEqual(isBizRecordCancelled({ status: "cancelled" }), true);
assert.strictEqual(isBizRecordCancelled({ status: " CANCELLED " }), true, "状态比较应忽略大小写与首尾空白");

console.log("returned-approval.test.js passed");
