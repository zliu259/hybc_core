const assert = require("assert");

const {
  QUICK_COMMENTS,
  validateDecisionComment,
  buildConfirmCopy,
  resolveActions,
  resolveFooterMode,
  isPayoutDirty,
  normalizePaymentMethodValue,
  buildPayoutPayload,
  buildPayoutSummary,
  pickNextPending,
  nextPendingToast
} = require("./approval-decision");

assert.ok(QUICK_COMMENTS.length > 0);

// ── 意见校验：通过可空，驳回、退回必须写原因 ──
assert.deepStrictEqual(validateDecisionComment("approve", "   "), {
  ok: true,
  comment: "同意",
  error: ""
});
assert.strictEqual(validateDecisionComment("approve", " 情况属实 ").comment, "情况属实");
assert.deepStrictEqual(validateDecisionComment("reject", ""), {
  ok: false,
  comment: "",
  error: "驳回需要写明原因"
});
assert.strictEqual(validateDecisionComment("reject", "   ").ok, false);
assert.deepStrictEqual(validateDecisionComment("return", " "), {
  ok: false,
  comment: "",
  error: "退回需要写明原因"
});
assert.deepStrictEqual(validateDecisionComment("reject", " 金额不符 "), {
  ok: true,
  comment: "金额不符",
  error: ""
});

// ── 二次确认文案：wx.showModal 的按钮最多 4 个字，超长调用直接失败 ──
["reject", "withdraw", "cancel"].forEach((action) => {
  [false, true].forEach((isSuperAdmin) => {
    const copy = buildConfirmCopy(action, { isSuperAdmin });
    assert.ok(copy.title && copy.content, `${action} 缺文案`);
    assert.ok(copy.confirmText.length <= 4, `${action} 确认按钮超过 4 字`);
  });
});
assert.strictEqual(buildConfirmCopy("cancel", { isSuperAdmin: true }).title, "确定终止流程？");
assert.strictEqual(buildConfirmCopy("cancel", { isSuperAdmin: false }).title, "确定取消审批？");
// 通过、退回不需要二次确认
assert.strictEqual(buildConfirmCopy("approve", {}), null);
assert.strictEqual(buildConfirmCopy("return", {}), null);

// ── 可用动作 ──
const baseDetail = (overrides = {}) => ({
  instance: {
    status: "in_progress",
    current_round: 1,
    current_node_key: "node_a",
    initiator_userid: "starter"
  },
  nodes: [{ id: 11, round: 1, node_key: "node_a" }],
  tasks: [],
  available_actions: [],
  ...overrides
});
const pendingTask = (assignee) => ({
  assignee_userid: assignee,
  status: "pending",
  round: 1,
  node_instance_id: 11
});

// 当前节点有我的待办：按服务端动作显示
const approver = resolveActions({
  detail: baseDetail({
    tasks: [pendingTask("me")],
    available_actions: ["approve", "reject", "return_initiator", "transfer"]
  }),
  userId: "me"
});
assert.strictEqual(approver.canApprove, true);
assert.strictEqual(approver.canReject, true);
assert.strictEqual(approver.canReturn, true);
assert.strictEqual(approver.canTransfer, true);
assert.strictEqual(approver.hasAnyAction, true);
assert.deepStrictEqual(approver.manageActions, []);
assert.deepStrictEqual(
  approver.moreActions.map((item) => item.action),
  ["transfer"]
);

// 既是审批人又是发起人：撤回、取消也收进「更多」
const both = resolveActions({
  detail: baseDetail({
    tasks: [pendingTask("me")],
    available_actions: ["withdraw", "cancel", "approve", "reject", "return_initiator", "transfer"]
  }),
  userId: "me"
});
assert.deepStrictEqual(
  both.moreActions.map((item) => item.action),
  ["transfer", "withdraw", "cancel"]
);

// 服务端没给动作时回退默认集合（旧接口兼容）
const legacy = resolveActions({ detail: baseDetail({ tasks: [pendingTask("me")] }), userId: "me" });
assert.strictEqual(legacy.canApprove, true);
assert.strictEqual(legacy.canTransfer, true);

// 我的待办不在当前节点：不能审批，避免对着旧节点点通过
const staleTask = resolveActions({
  detail: baseDetail({
    tasks: [{ ...pendingTask("me"), node_instance_id: 99 }],
    available_actions: ["approve", "reject"]
  }),
  userId: "me"
});
assert.strictEqual(staleTask.hasAnyAction, false);

// 发起人没有待办：只能撤回、取消
const initiator = resolveActions({
  detail: baseDetail({ available_actions: ["withdraw", "cancel"] }),
  userId: "starter"
});
assert.strictEqual(initiator.hasAnyAction, false);
assert.deepStrictEqual(
  initiator.manageActions.map((item) => [item.action, item.label]),
  [
    ["withdraw", "撤回"],
    ["cancel", "取消审批"]
  ]
);

// 超管的取消是终止流程
const admin = resolveActions({
  detail: baseDetail({ available_actions: ["cancel"] }),
  userId: "boss",
  isSuperAdmin: true
});
assert.deepStrictEqual(
  admin.manageActions.map((item) => item.label),
  ["终止流程"]
);

// 只读视图：审批动作全关；从「我发起的」进入时保留撤回、取消，这是发起人唯一的入口
const readOnlyDetail = baseDetail({
  tasks: [pendingTask("me")],
  available_actions: ["approve", "reject", "withdraw", "cancel"]
});
const readOnly = resolveActions({ detail: readOnlyDetail, userId: "me", readOnly: true });
assert.strictEqual(readOnly.hasAnyAction, false);
assert.deepStrictEqual(readOnly.manageActions, []);
const readOnlyInitiated = resolveActions({
  detail: readOnlyDetail,
  userId: "me",
  readOnly: true,
  allowManageInReadOnly: true
});
assert.strictEqual(readOnlyInitiated.hasAnyAction, false);
assert.deepStrictEqual(
  readOnlyInitiated.manageActions.map((item) => item.action),
  ["withdraw", "cancel"]
);

// 已结束的审批什么动作都没有，即使接口带了旧值
const finished = resolveActions({
  detail: baseDetail({
    instance: { status: "approved" },
    tasks: [pendingTask("me")],
    available_actions: ["approve", "cancel"]
  }),
  userId: "me"
});
assert.strictEqual(finished.hasAnyAction, false);
assert.deepStrictEqual(finished.manageActions, []);

// ── 底部栏形态 ──
assert.strictEqual(
  resolveFooterMode({ hasAnyAction: true, manageActions: [], canEditReturnedBusiness: false, userAlreadyActed: false }),
  "decide"
);
assert.strictEqual(
  resolveFooterMode({
    hasAnyAction: false,
    manageActions: [{ action: "cancel" }],
    canEditReturnedBusiness: false,
    userAlreadyActed: true
  }),
  "manage"
);
assert.strictEqual(
  resolveFooterMode({ hasAnyAction: false, manageActions: [], canEditReturnedBusiness: true, userAlreadyActed: true }),
  "edit"
);
assert.strictEqual(
  resolveFooterMode({ hasAnyAction: false, manageActions: [], canEditReturnedBusiness: false, userAlreadyActed: true }),
  "acted"
);
assert.strictEqual(
  resolveFooterMode({
    hasAnyAction: false,
    manageActions: [],
    canEditReturnedBusiness: false,
    userAlreadyActed: true,
    readOnly: true
  }),
  ""
);
assert.strictEqual(
  resolveFooterMode({ hasAnyAction: false, manageActions: [], canEditReturnedBusiness: false, userAlreadyActed: false }),
  ""
);

// ── 支付方案：没改动不提交 ──
const plan = { entityId: 3, accountId: 7, method: "transfer" };
assert.strictEqual(isPayoutDirty(plan, { ...plan }), false);
assert.strictEqual(isPayoutDirty(plan, { ...plan, method: "cash" }), true);
assert.strictEqual(isPayoutDirty(plan, { ...plan, accountId: 8 }), true);
assert.strictEqual(isPayoutDirty(plan, { ...plan, entityId: 4 }), true);
// 基线还没建好（账户没加载完）一律不算改动，否则会把半成品写回去
assert.strictEqual(isPayoutDirty(null, plan), false);

// 历史数据的支付方式写法不一，归一后才能对上选择器；认不出的落「可后续补充」
assert.strictEqual(normalizePaymentMethodValue("bank_transfer"), "transfer");
assert.strictEqual(normalizePaymentMethodValue("对公转账"), "transfer");
assert.strictEqual(normalizePaymentMethodValue("personal_transfer"), "personal_transfer");
assert.strictEqual(normalizePaymentMethodValue("现金"), "cash");
assert.strictEqual(normalizePaymentMethodValue(" bill "), "bill");
assert.strictEqual(normalizePaymentMethodValue("constructor"), "");
assert.strictEqual(normalizePaymentMethodValue(null), "");

const entity = { id: 3 };
const account = { id: 7, bank_name: "工行", account_no: "6222", entity_id: 3 };
assert.deepStrictEqual(
  buildPayoutPayload({ paymentEntity: entity, paymentAccount: account, paymentMethod: "transfer" }),
  {
    payment_entity_id: 3,
    payment_entity_bank_account_id: 7,
    payment_account: "工行 / 6222",
    payment_method: "transfer"
  }
);
// 只选了账户时主体跟着账户走
assert.strictEqual(
  buildPayoutPayload({ paymentEntity: null, paymentAccount: account, paymentMethod: "" }).payment_entity_id,
  3
);
assert.deepStrictEqual(
  buildPayoutPayload({ paymentEntity: null, paymentAccount: null, paymentMethod: "" }),
  {}
);

assert.strictEqual(
  buildPayoutSummary({ methodLabel: "对公转账", entityLabel: "恒越劳务", accountLabel: "工行 / 6222" }),
  "对公转账，恒越劳务，工行 / 6222"
);
assert.strictEqual(buildPayoutSummary({ methodLabel: "", entityLabel: "", accountLabel: "" }), "尚未选择");

// ── 下一条待办 ──
assert.strictEqual(pickNextPending([{ id: 5 }, { id: 8 }], 5), 8);
assert.strictEqual(pickNextPending([{ id: 8 }, { id: 9 }], 5), 8);
assert.strictEqual(pickNextPending([{ id: 5 }], 5), 0);
assert.strictEqual(pickNextPending([], 5), 0);
assert.strictEqual(pickNextPending(null, 5), 0);
assert.strictEqual(pickNextPending([{ id: "abc" }, { id: 0 }, null], 5), 0);

assert.strictEqual(nextPendingToast("已通过", { nextId: 8, pendingCount: 2 }), "已通过，打开下一条");
assert.strictEqual(nextPendingToast("已通过", { nextId: 0, pendingCount: 0 }), "已通过，待办已处理完");
// 下一节点还是自己时列表里仍有这一单，不能说处理完了
assert.strictEqual(nextPendingToast("已通过", { nextId: 0, pendingCount: 1 }), "已通过");
// 取不到列表时不知道还有没有待办，不能说处理完了
assert.strictEqual(nextPendingToast("已通过", { nextId: 0, pendingCount: null }), "已通过");

console.log("approval-decision.test.js passed");
