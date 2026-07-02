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
