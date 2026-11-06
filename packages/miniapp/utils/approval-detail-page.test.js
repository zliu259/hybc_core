/**
 * 审批详情页的流程测试：真实页面代码 + 真实视图模型，只替换接口、登录态和 wx。
 * 电脑模拟器登录不通，这里是合入前唯一能跑的端到端逻辑检查；界面和键盘仍要真机验证。
 */
const assert = require("assert");
const path = require("path");

const realSetTimeout = setTimeout;
// 页面用定时器等 toast 显示完再跳转，测试里不必真等
global.setTimeout = (fn) => realSetTimeout(fn, 0);
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 5));

const INSTANCE_ID = 101;
const PAYMENT_ID = 55;

const state = {};

const resetState = () => {
  state.calls = [];
  state.toasts = [];
  state.modals = [];
  state.navigations = [];
  state.confirmAnswer = true;
  state.actionSheetIndex = 0;
  state.pendingRows = [{ id: INSTANCE_ID }, { id: 202 }];
  state.pendingFails = false;
  state.approveFails = false;
  state.profile = { username: "me", roles: ["manager"] };
  state.pages = [{ route: "pages/approval/index" }, { route: "pages/approval-detail/index" }];
  state.instance = {
    id: INSTANCE_ID,
    instance_no: "AP-101",
    biz_type: "payment_request",
    biz_id: PAYMENT_ID,
    biz_summary: "付款摘要",
    status: "in_progress",
    initiator_userid: "starter",
    current_round: 1,
    current_node_key: "node_a",
    submitted_at: "2026-11-01T00:00:00Z"
  };
  state.availableActions = ["approve", "reject", "return_initiator", "transfer"];
  state.tasks = [
    { id: 1, node_instance_id: 11, round: 1, assignee_userid: "me", status: "pending", action: null }
  ];
  state.payment = {
    id: PAYMENT_ID,
    serial_no: "SP-1",
    amount: 100500,
    amount_cn: "壹拾零万零伍佰零元",
    content: "2026.9 工资",
    project_id: 7,
    category: "progress",
    payment_method: "transfer",
    payment_entity_id: 3,
    payment_entity_bank_account_id: 9,
    remark: "正文\n[超管修改 2026-10-01T02:03:04.000Z] me：小程序审批页更新支付信息",
    payee: { name: "北京鑫丰畅", bank_name: "工行", bank_account: "6222" },
    attachments_json: JSON.stringify([{ file_key: "k1", file_name: "工资表.pdf", file_size: 2048 }])
  };
  state.reviews = [];
};

const respond = (options) => {
  const { method, path: url } = options;
  state.calls.push({ method, path: url, data: options.data });
  if (method === "GET") {
    if (url === "/api/v1/auth/wecom/contacts") {
      return {
        data: {
          users: [
            { userid: "me", name: "我" },
            { userid: "u2", name: "张三" },
            { userid: "u3", name: "李四" }
          ]
        }
      };
    }
    if (url.indexOf("/api/v1/project") === 0) return { data: [{ id: 7, project_name: "顶管一期" }] };
    if (url.indexOf("/api/v1/entity?") === 0) {
      return {
        data: [
          { id: 3, entity_name: "恒越劳务", status: "active" },
          { id: 4, entity_name: "恒越机械", status: "active" }
        ]
      };
    }
    if (url === "/api/v1/entity/3/bank-accounts") {
      return { data: [{ id: 9, entity_id: 3, bank_name: "工行", account_no: "6222", status: "active" }] };
    }
    if (url === "/api/v1/entity/4/bank-accounts") {
      return { data: [{ id: 12, entity_id: 4, bank_name: "农行", account_no: "6228", status: "active" }] };
    }
    if (url === `/api/v1/approval/${INSTANCE_ID}`) {
      return {
        data: {
          instance: state.instance,
          nodes: [{ id: 11, round: 1, sort_order: 1, node_key: "node_a", node_name: "财务审批", node_type: "sequential", status: "pending" }],
          tasks: state.tasks,
          ai_gate_reviews: state.reviews,
          available_actions: state.availableActions
        }
      };
    }
    if (url === `/api/v1/payment/${PAYMENT_ID}`) return { data: state.payment };
    if (url === `/api/v1/payment/${PAYMENT_ID}/risk-report`) return { data: null };
    if (url.indexOf("/api/v1/approval/pending") === 0) {
      if (state.pendingFails) throw new Error("网络异常");
      return { data: state.pendingRows };
    }
    throw new Error(`未预期的 GET ${url}`);
  }
  if (url === `/api/v1/approval/${INSTANCE_ID}/approve` && state.approveFails) {
    throw new Error("当前节点已被处理");
  }
  return { success: true };
};

global.wx = {
  showToast: (options) => state.toasts.push(options.title),
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  vibrateLong: () => {},
  showModal: (options) => {
    state.modals.push(options);
    options.success({ confirm: state.confirmAnswer, cancel: !state.confirmAnswer });
  },
  showActionSheet: (options) => {
    state.lastSheet = options.itemList;
    options.success({ tapIndex: state.actionSheetIndex });
  },
  redirectTo: (options) => state.navigations.push(["redirectTo", options.url]),
  navigateTo: (options) => state.navigations.push(["navigateTo", options.url]),
  navigateBack: () => state.navigations.push(["navigateBack"])
};
global.getCurrentPages = () => state.pages;

const stubModule = (file, exports) => {
  const resolved = path.join(__dirname, file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stubModule("request.js", {
  request: async (options) => respond(options),
  buildUrl: (url) => `https://api.test${url}`
});
stubModule("auth.js", {
  getToken: () => "token",
  getUserProfile: () => state.profile
});

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};
require("../pages/approval-detail/index.js");

const createPage = async (options = { id: String(INSTANCE_ID) }) => {
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
    selectComponent: (selector) => {
      assert.strictEqual(selector, "#transferPicker");
      return { open: () => state.navigations.push(["openTransferPicker"]) };
    }
  };
  page.onLoad(options);
  await page.onShow();
  return page;
};

// 上一段流程的跳转定时器要先跑完，否则会记到下一段头上
const fresh = async () => {
  await flush();
  resetState();
};

const writes = () => state.calls.filter((call) => call.method !== "GET");
const writeTo = (suffix) => writes().filter((call) => call.path.endsWith(suffix));

const run = async () => {
  // ── 金额大写现算，不读 amount_cn ──
  await fresh();
  let page = await createPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.hero.amountText, "100,500.00");
  assert.strictEqual(page.data.hero.amountUpper, "壹拾万零伍佰元整");
  assert.strictEqual(page.data.hero.title, "2026.9 工资");
  assert.strictEqual(page.data.footerMode, "decide");
  // 修改日志从备注分离
  assert.strictEqual(page.data.detailRows.find((row) => row.label === "备注").value, "正文");
  assert.strictEqual(page.data.remarkEdits.length, 1);
  assert.strictEqual(page.data.remarkEdits[0].note, "小程序审批页更新支付信息");
  assert.strictEqual(page.data.remarkEditsOpen, false);
  // 支付方案默认折叠成摘要
  assert.strictEqual(page.data.payoutVisible, true);
  assert.strictEqual(page.data.payoutEditorOpen, false);
  assert.strictEqual(page.data.payoutSummary, "对公转账，恒越劳务，工行 / 6222");
  assert.strictEqual(page.data.payoutDirty, false);
  // 附件带可读体积
  assert.strictEqual(page.data.detailAttachments[0].sizeText, "2.0 KB");
  // 没有 AI 结果
  assert.strictEqual(page.data.ai.latest, null);

  // ── 支付方案没改动不提交，意见为空记为「同意」 ──
  await page.onApprove();
  assert.deepStrictEqual(writes().map((call) => call.path), [`/api/v1/approval/${INSTANCE_ID}/approve`]);
  assert.deepStrictEqual(writes()[0].data, { comment: "同意" });

  // 超管同样不提交：这才是每次审批多一条「超管修改」日志的来源
  await fresh();
  state.profile = { username: "me", roles: ["super_admin"] };
  page = await createPage();
  await page.onApprove();
  assert.strictEqual(writeTo(`/payment/${PAYMENT_ID}`).length, 0);
  assert.strictEqual(writeTo("/approve").length, 1);

  // ── 改过支付方案：先存再审批 ──
  await fresh();
  state.profile = { username: "me", roles: ["super_admin"] };
  page = await createPage();
  page.onPaymentMethodChange({ detail: { value: page.data.paymentMethodValueOptions.indexOf("cash") } });
  assert.strictEqual(page.data.payoutDirty, true);
  page.setData({ actionComment: " 情况属实 " });
  await page.onApprove();
  assert.deepStrictEqual(writes().map((call) => call.path), [
    `/api/v1/payment/${PAYMENT_ID}`,
    `/api/v1/approval/${INSTANCE_ID}/approve`
  ]);
  assert.strictEqual(writes()[0].data.payment_method, "cash");
  assert.strictEqual(writes()[0].data.admin_edit_mode, true);
  assert.deepStrictEqual(writes()[1].data, { comment: "情况属实" });

  // 改回原值不算改动
  await fresh();
  page = await createPage();
  const original = page.data.paymentMethodIndex;
  page.onPaymentMethodChange({ detail: { value: original + 1 } });
  page.onPaymentMethodChange({ detail: { value: original } });
  assert.strictEqual(page.data.payoutDirty, false);
  await page.onApprove();
  assert.strictEqual(writeTo(`/payment/${PAYMENT_ID}`).length, 0);

  // 换主体：默认带上该主体第一个账户，主体和账户不会错配
  await fresh();
  page = await createPage();
  const entityIndex = page.data.paymentEntityLabels.indexOf("恒越机械");
  await page.onPaymentEntityChange({ detail: { value: entityIndex } });
  assert.strictEqual(page.data.paymentAccountLabels[page.data.paymentAccountIndex], "农行 / 6228");
  assert.strictEqual(page.data.payoutDirty, true);
  await page.onApprove();
  assert.strictEqual(writes()[0].data.payment_entity_id, 4);
  assert.strictEqual(writes()[0].data.payment_entity_bank_account_id, 12);

  // 审批失败重试时不重复保存支付方案
  await fresh();
  state.approveFails = true;
  page = await createPage();
  page.onPaymentMethodChange({ detail: { value: page.data.paymentMethodValueOptions.indexOf("cash") } });
  await page.onApprove();
  assert.strictEqual(writeTo(`/payment/${PAYMENT_ID}`).length, 1);
  assert.deepStrictEqual(state.navigations, []);
  assert.strictEqual(page.data.acting, false);
  assert.ok(state.toasts.indexOf("当前节点已被处理") >= 0, "服务端报错要原样提示");
  state.approveFails = false;
  await page.onApprove();
  assert.strictEqual(writeTo(`/payment/${PAYMENT_ID}`).length, 1);
  assert.strictEqual(writeTo("/approve").length, 2);

  // ── 处理完打开下一条待办 ──
  await fresh();
  page = await createPage();
  await page.onApprove();
  await flush();
  assert.deepStrictEqual(state.navigations, [["redirectTo", "/pages/approval-detail/index?id=202"]]);
  assert.ok(state.toasts.indexOf("已通过，打开下一条") >= 0);

  // 防重入：跳转前再点一次不会重复提交
  await fresh();
  page = await createPage();
  await Promise.all([page.onApprove(), page.onApprove()]);
  await page.onApprove();
  assert.strictEqual(writeTo("/approve").length, 1);

  // 没有待办：回列表并提示处理完；来自列表就返回，避免列表页叠两层
  await fresh();
  state.pendingRows = [];
  page = await createPage();
  await page.onApprove();
  await flush();
  assert.deepStrictEqual(state.navigations, [["navigateBack"]]);
  assert.ok(state.toasts.indexOf("已通过，待办已处理完") >= 0);

  // 从企微卡片直达（前面没有列表页）：打开列表
  await fresh();
  state.pendingRows = [];
  state.pages = [{ route: "pages/approval-detail/index" }];
  page = await createPage();
  await page.onApprove();
  await flush();
  assert.deepStrictEqual(state.navigations, [["redirectTo", "/pages/approval/index"]]);

  // 取不到待办不影响本次结果，也不能说处理完了
  await fresh();
  state.pendingFails = true;
  page = await createPage();
  await page.onApprove();
  await flush();
  assert.deepStrictEqual(state.navigations, [["navigateBack"]]);
  assert.ok(state.toasts.indexOf("已通过") >= 0);
  assert.ok(state.toasts.indexOf("已通过，待办已处理完") < 0);

  // ── 驳回：必须写原因 + 二次确认 ──
  await fresh();
  page = await createPage();
  await page.onReject();
  assert.strictEqual(page.data.commentError, "驳回需要写明原因");
  assert.strictEqual(page.data.commentFocus, true);
  assert.strictEqual(state.modals.length, 0);
  assert.strictEqual(writes().length, 0);
  // 开始输入后报错消失
  page.onCommentInput({ detail: { value: "金额不符" } });
  assert.strictEqual(page.data.commentError, "");
  state.confirmAnswer = false;
  await page.onReject();
  assert.strictEqual(state.modals.length, 1);
  assert.strictEqual(state.modals[0].confirmText, "确定驳回");
  assert.strictEqual(writes().length, 0);
  state.confirmAnswer = true;
  await page.onReject();
  assert.deepStrictEqual(writes().map((call) => [call.path, call.data]), [
    [`/api/v1/approval/${INSTANCE_ID}/reject`, { comment: "金额不符" }]
  ]);
  await flush();
  assert.ok(state.toasts.indexOf("已驳回，打开下一条") >= 0);

  // ── 退回：必须写原因，不弹确认 ──
  await fresh();
  page = await createPage();
  await page.onReturn();
  assert.strictEqual(page.data.commentError, "退回需要写明原因");
  assert.strictEqual(writes().length, 0);
  page.setData({ actionComment: "请补充材料" });
  await page.onReturn();
  assert.strictEqual(state.modals.length, 0);
  assert.deepStrictEqual(writes().map((call) => [call.path, call.data]), [
    [`/api/v1/approval/${INSTANCE_ID}/return`, { type: "initiator", comment: "请补充材料" }]
  ]);

  // ── 更多：转办走可搜索列表，确认后提交 ──
  await fresh();
  page = await createPage();
  assert.deepStrictEqual(page.data.moreActions.map((item) => item.action), ["transfer"]);
  await page.onMoreAction();
  assert.deepStrictEqual(state.navigations, [["openTransferPicker"]]);
  // 不能转给自己，列表里没有当前用户
  assert.deepStrictEqual(page.data.transferLabels, ["请选择转办人", "张三", "李四"]);
  state.navigations = [];
  // 占位项不算选中
  await page.onTransferPick({ detail: { value: 0 } });
  assert.strictEqual(writes().length, 0);
  await page.onTransferPick({ detail: { value: 2 } });
  assert.ok(state.modals[0].content.indexOf("李四") >= 0);
  assert.deepStrictEqual(writes().map((call) => [call.path, call.data]), [
    [`/api/v1/approval/${INSTANCE_ID}/transfer`, { to_userid: "u3", reason: "小程序转办" }]
  ]);

  // ── 发起人：撤回、取消需要二次确认，完成后留在本页刷新 ──
  await fresh();
  state.profile = { username: "starter", roles: ["operator"] };
  state.tasks = [];
  state.availableActions = ["withdraw", "cancel"];
  page = await createPage();
  assert.strictEqual(page.data.footerMode, "manage");
  assert.strictEqual(page.data.payoutVisible, false);
  state.confirmAnswer = false;
  await page.onManageAction({ currentTarget: { dataset: { action: "withdraw" } } });
  assert.strictEqual(state.modals[0].confirmText, "确定撤回");
  assert.strictEqual(writes().length, 0);
  state.confirmAnswer = true;
  await page.onManageAction({ currentTarget: { dataset: { action: "withdraw" } } });
  assert.strictEqual(writes()[0].path, `/api/v1/approval/${INSTANCE_ID}/withdraw`);
  await flush();
  assert.deepStrictEqual(state.navigations, []);
  assert.ok(state.calls.filter((call) => call.path === `/api/v1/approval/${INSTANCE_ID}`).length >= 2, "要刷新详情");
  assert.ok(state.toasts.indexOf("已撤回") >= 0);

  await fresh();
  state.profile = { username: "starter", roles: ["operator"] };
  state.tasks = [];
  state.availableActions = ["withdraw", "cancel"];
  page = await createPage();
  await page.onManageAction({ currentTarget: { dataset: { action: "cancel" } } });
  assert.strictEqual(state.modals[0].confirmText, "确定取消");
  assert.strictEqual(writes()[0].path, `/api/v1/approval/${INSTANCE_ID}/cancel`);
  assert.ok(state.toasts.indexOf("已取消审批") >= 0);

  // 从「我发起的」只读进入：能撤回、取消，但不能审批
  await fresh();
  state.profile = { username: "me", roles: ["operator"] };
  state.availableActions = ["approve", "withdraw", "cancel"];
  page = await createPage({ id: String(INSTANCE_ID), readonly: "1", from: "initiated" });
  assert.strictEqual(page.data.footerMode, "manage");
  assert.strictEqual(page.data.canApprove, false);
  assert.strictEqual(page.data.payoutVisible, false);
  await page.onApprove();
  assert.strictEqual(writes().length, 0);

  // 从付款查询只读进入：什么都不能做
  await fresh();
  state.availableActions = ["approve", "withdraw", "cancel"];
  page = await createPage({ id: String(INSTANCE_ID), readonly: "1", from: "query-payment" });
  assert.strictEqual(page.data.footerMode, "");

  // ── AI 审查：没读完附件的告警、findings 分组、旧数据回退 ──
  await fresh();
  state.reviews = [
    {
      task_id: 2,
      node_key: "node_a",
      status: "completed",
      summary: "金额一致",
      decision: "warn",
      comment: "AI审查放行（需人工重点关注）：金额一致",
      findings: [
        { dimension: "amount_terms", status: "pass", detail: "一致", evidence: "" },
        { dimension: "subject_match", status: "warn", detail: "主体待核对", evidence: "" }
      ],
      evidence_coverage: {
        complete: false,
        summary: "未读完",
        items: [{ name: "a.pdf", status: "partial", description: "《a.pdf》共 6 页，已读 3 页，未读第 4-6 页" }]
      }
    },
    { task_id: 1, node_key: "node_a", status: "completed", outcome: "reject", comment: "AI审查不通过：旧结论" }
  ];
  page = await createPage();
  assert.strictEqual(page.data.ai.latest.verdictLabel, "放行·需人工关注");
  assert.strictEqual(page.data.ai.latest.coverage.incomplete, true);
  assert.strictEqual(page.data.ai.latest.coverage.rows[0].text, "《a.pdf》共 6 页，已读 3 页，未读第 4-6 页");
  assert.strictEqual(page.data.ai.latest.concerns.length, 1);
  assert.strictEqual(page.data.ai.latest.passed.length, 1);
  assert.strictEqual(page.data.aiPassedOpen, false);
  page.toggleAiPassed();
  assert.strictEqual(page.data.aiPassedOpen, true);
  assert.strictEqual(page.data.ai.earlier.length, 1);

  // ── 通过时的快捷意见与键盘状态 ──
  await fresh();
  page = await createPage();
  page.onCommentFocus({ detail: { height: 300 } });
  assert.strictEqual(page.data.keyboardHeight, 300);
  assert.strictEqual(page.data.commentFocused, true);
  page.onKeyboardHeightChange({ detail: { height: 280 } });
  assert.strictEqual(page.data.keyboardHeight, 280);
  page.onQuickComment({ currentTarget: { dataset: { text: "情况属实" } } });
  assert.strictEqual(page.data.actionComment, "情况属实");
  page.onCommentBlur();
  assert.strictEqual(page.data.keyboardHeight, 0);
  assert.strictEqual(page.data.commentFocus, false);
  await flush();
  assert.strictEqual(page.data.commentFocused, false);

  // ── 退回后的发起人：编辑重提入口不受只读影响 ──
  await fresh();
  state.profile = { username: "starter", roles: ["operator"] };
  state.instance = { ...state.instance, status: "returned" };
  state.tasks = [];
  state.availableActions = ["resubmit"];
  page = await createPage({ id: String(INSTANCE_ID), readonly: "1", from: "initiated" });
  assert.strictEqual(page.data.footerMode, "edit");

  // ── 编号非法不发请求 ──
  await fresh();
  page = await createPage({ id: "0" });
  assert.strictEqual(page.data.detailState, "error");

  console.log("approval-detail-page.test.js passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
