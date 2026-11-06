/**
 * 付款详情页的流程测试：真实页面代码 + 真实视图模型，只替换接口、登录态和 wx。
 * 电脑模拟器登录不通，这里只能检查页面数据，界面仍要真机验证。
 */
const assert = require("assert");
const path = require("path");

const realSetTimeout = setTimeout;
global.setTimeout = (fn) => realSetTimeout(fn, 0);
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 5));

const PAYMENT_ID = 55;
const INSTANCE_ID = 101;

const state = {};

const basePayment = () => ({
  id: PAYMENT_ID,
  serial_no: "SP-20261106-0001",
  status: "pending_approval",
  amount: 100500,
  content: "2026.9 工资",
  applicant_userid: "starter",
  project_id: 7,
  project: { project_name: "顶管一期", project_code: "P-7" },
  category: "progress",
  payment_method: "transfer",
  expected_payment_date: "2026-11-20",
  payment_entity_id: 3,
  payment_entity: { entity_name: "恒越劳务" },
  payment_account: "工行 / 6222",
  contract_id: 9,
  contract: { contract_no: "HT-9", counterparty: "北京鑫丰畅", total_amount: 500000, paid_amount: 200000 },
  payee: { name: "北京鑫丰畅", bank_name: "建行", bank_account: "6227" },
  approval_instance_id: INSTANCE_ID,
  attachments_json: JSON.stringify([{ file_key: "fin/k1", file_name: "工资表.pdf", file_size: 2048 }]),
  remark: "正文\n[超管修改 2026-10-01T02:03:04.000Z] starter：改了账户",
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-02T00:00:00.000Z"
});

const baseApproval = () => ({
  instance: {
    id: INSTANCE_ID,
    status: "in_progress",
    current_node_key: "node_b",
    current_round: 1
  },
  nodes: [
    { id: 11, node_key: "node_a", node_name: "AI审核", node_type: "ai_gate", round: 1, sort_order: 1, status: "completed" },
    { id: 12, node_key: "node_b", node_name: "财务审批", node_type: "sequential", round: 1, sort_order: 2, status: "in_progress" }
  ],
  tasks: [
    {
      id: 1,
      node_instance_id: 11,
      assignee_userid: "AI_GATE",
      status: "completed",
      action: "approve",
      comment: "AI审查通过：金额与合同一致"
    },
    { id: 2, node_instance_id: 12, assignee_userid: "boss", status: "pending", action: null, comment: null }
  ],
  ai_gate_reviews: [
    {
      task_id: 1,
      node_key: "node_a",
      status: "completed",
      decision: "pass",
      summary: "金额与合同一致",
      comment: "AI审查通过：金额与合同一致",
      findings: [],
      recommendations: []
    }
  ]
});

const resetState = () => {
  state.calls = [];
  state.toasts = [];
  state.navigations = [];
  state.backs = 0;
  state.previews = [];
  state.documents = [];
  state.profile = { username: "me", roles: ["finance"] };
  state.payment = basePayment();
  state.approval = baseApproval();
  state.risk = { status: "none", result: null };
  state.paymentFails = false;
  state.approvalFails = false;
};

const respond = (options) => {
  const { path: url } = options;
  state.calls.push(url);
  if (url === `/api/v1/payment/${PAYMENT_ID}`) {
    if (state.paymentFails) throw new Error("付款单不存在");
    return { data: state.payment };
  }
  if (url === `/api/v1/payment/${PAYMENT_ID}/risk-report`) return { data: state.risk };
  if (url === `/api/v1/approval/${INSTANCE_ID}`) {
    if (state.approvalFails) throw new Error("无权限");
    return { data: state.approval };
  }
  if (url === "/api/v1/auth/wecom/contacts") {
    return { data: { users: [{ userid: "starter", name: "张三" }, { userid: "boss", name: "李总" }] } };
  }
  if (url === "/api/v1/upload/sign-download") {
    return { data: { url: `/api/v1/upload/object/${encodeURIComponent(options.data.key)}?sig=1` } };
  }
  throw new Error(`未预期的请求 ${url}`);
};

global.wx = {
  showToast: (options) => state.toasts.push(options.title),
  navigateBack: () => {
    state.backs += 1;
  },
  navigateTo: (options) => state.navigations.push(options.url),
  previewImage: (options) => state.previews.push(options.current),
  downloadFile: (options) => options.success({ statusCode: 200, tempFilePath: "/tmp/doc.pdf" }),
  openDocument: (options) => state.documents.push(options.filePath)
};

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
require("../pages/query-payment-detail/index.js");

const openPage = async (options = {}) => {
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    }
  };
  await page.onLoad({ id: String(PAYMENT_ID), ...options });
  await page.onShow();
  return page;
};

const factValue = (page, label) => {
  const fact = page.data.detail.facts.find((item) => item.label === label);
  return fact ? fact.value : undefined;
};
const rowValue = (page, label) => {
  const row = page.data.detail.rows.find((item) => item.label === label);
  return row ? row.value : undefined;
};

const run = async () => {
  // 回归：AI 关卡带意见的付款曾因漏引函数整页打不开（提示 humanizeAiText is not defined）
  resetState();
  let page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.deepStrictEqual(state.toasts, []);

  // 头部：多少钱、付给谁、干什么用
  assert.strictEqual(page.data.detail.amountText, "100,500.00");
  assert.strictEqual(page.data.detail.amountCn, "壹拾万零伍佰元整");
  assert.strictEqual(page.data.detail.title, "2026.9 工资");
  assert.strictEqual(page.data.detail.serialNo, "SP-20261106-0001");
  assert.strictEqual(page.data.detail.statusText, "待审批");
  assert.strictEqual(factValue(page, "付款单位"), "恒越劳务");
  assert.strictEqual(factValue(page, "收款方"), "北京鑫丰畅");
  assert.strictEqual(factValue(page, "所属项目"), "顶管一期");
  assert.strictEqual(factValue(page, "申请人"), "张三");
  assert.strictEqual(page.data.waitText, "等待财务审批");

  // 明细：和审批详情同一口径，多一行合同余额
  assert.strictEqual(rowValue(page, "关联合同"), "HT-9 - 北京鑫丰畅");
  assert.strictEqual(rowValue(page, "剩余额度"), "300,000.00 元（合同 500,000.00，已付 200,000.00）");
  assert.strictEqual(rowValue(page, "付款类别"), "进度款");
  assert.strictEqual(rowValue(page, "收款账号"), "建行 / 6227");
  assert.strictEqual(rowValue(page, "付款账户"), "工行 / 6222");
  assert.strictEqual(rowValue(page, "付款方式"), "对公转账");
  // 备注只留发起人写的，系统修改记录单独折叠
  assert.strictEqual(rowValue(page, "备注"), "正文");
  assert.strictEqual(page.data.detail.remarkEdits.length, 1);
  assert.strictEqual(page.data.detail.remarkEdits[0].byText, "张三");
  // 不再拉全量项目列表
  assert.ok(!state.calls.some((url) => url.indexOf("/api/v1/project") === 0));

  // AI 审查和流程
  assert.strictEqual(page.data.aiVisible, true);
  assert.strictEqual(page.data.ai.latest.verdictLabel, "建议通过");
  assert.strictEqual(page.data.timelineNodes.length, 2);
  assert.strictEqual(page.data.timelineNodes[0].tasks[0].assigneeLabel, "AI审查");
  assert.strictEqual(page.data.showApprovalLink, true);

  // 附件：受保护前缀走签名地址
  assert.strictEqual(page.data.detail.attachments[0].extLabel, "PDF");
  assert.strictEqual(page.data.detail.attachments[0].sizeText.length > 0, true);
  await page.openAttachment({
    currentTarget: { dataset: { key: "fin/k1", name: "工资表.pdf", url: "" } }
  });
  await flush();
  assert.deepStrictEqual(state.documents, ["/tmp/doc.pdf"]);
  await page.openAttachment({
    currentTarget: { dataset: { key: "fin/k2", name: "凭证.jpg", url: "" } }
  });
  assert.strictEqual(state.previews[0], "https://api.test/api/v1/upload/object/fin%2Fk2?sig=1");

  // 从附件预览返回不重新请求
  const callsBefore = state.calls.length;
  await page.onShow();
  assert.strictEqual(state.calls.length, callsBefore);

  // 跳审批详情：只读进入，且对方页不再链回来
  page.openApprovalDetail();
  assert.strictEqual(
    state.navigations[0],
    `/pages/approval-detail/index?id=${INSTANCE_ID}&readonly=1&from=query-payment`
  );

  // 未提审：没有 AI 和流程，也不打审批接口
  resetState();
  state.payment = { ...basePayment(), status: "draft", approval_instance_id: null };
  page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.aiVisible, false);
  assert.strictEqual(page.data.timelineNodes.length, 0);
  assert.strictEqual(page.data.showApprovalLink, false);
  assert.strictEqual(page.data.approvalUnavailable, false);
  assert.ok(!state.calls.some((url) => url.indexOf("/api/v1/approval/") === 0));

  // 没跑过关卡但有风控报告：AI 卡片要显示，报告默认展开
  resetState();
  state.payment = { ...basePayment(), status: "draft", approval_instance_id: null };
  state.risk = { status: "completed", result: { summary: "风险可控", overall_risk: "low" } };
  page = await openPage();
  assert.strictEqual(page.data.aiVisible, true);
  assert.strictEqual(page.data.aiReportTitle, "付款风控报告");
  assert.strictEqual(page.data.aiReportOpen, true);

  // 审批接口取不到不挡付款单本身
  resetState();
  state.approvalFails = true;
  page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.detail.amountText, "100,500.00");
  assert.strictEqual(page.data.timelineNodes.length, 0);
  // 审批详情只对参与人开放：说清楚看不到，也不给打不开的入口
  assert.strictEqual(page.data.approvalUnavailable, true);
  assert.strictEqual(page.data.showApprovalLink, false);

  // 退回：原因写在头部，流程默认展开
  resetState();
  state.payment = { ...basePayment(), status: "draft" };
  state.approval = {
    ...baseApproval(),
    instance: { ...baseApproval().instance, status: "returned" },
    tasks: [
      {
        id: 2,
        node_instance_id: 12,
        assignee_userid: "boss",
        status: "completed",
        action: "return_initiator",
        comment: "发票抬头不对",
        acted_at: "2026-11-03T00:00:00.000Z"
      }
    ],
    ai_gate_reviews: []
  };
  page = await openPage();
  assert.strictEqual(page.data.stopReasonText, "退回原因：发票抬头不对");
  assert.strictEqual(page.data.stopIsReturned, true);
  assert.strictEqual(page.data.flowCollapsed, false);
  assert.strictEqual(page.data.waitText, "");

  // 已付款：付款执行信息；只写日期的不补时分秒
  resetState();
  state.payment = {
    ...basePayment(),
    status: "paid",
    paid_at: "2026-11-05",
    payment_reference: "BANK-1",
    paid_by_userid: "boss"
  };
  page = await openPage();
  assert.strictEqual(page.data.detail.statusText, "已付款");
  assert.deepStrictEqual(
    page.data.detail.payoutRows.map((item) => [item.label, item.value]),
    [
      ["支付日期", "2026-11-05"],
      ["支付流水号", "BANK-1"],
      ["经办人", "李总"]
    ]
  );

  // 已审批未付款：一句话说明
  resetState();
  state.payment = { ...basePayment(), status: "approved" };
  page = await openPage();
  assert.strictEqual(page.data.detail.payoutRows.length, 0);
  assert.strictEqual(page.data.detail.payoutNote, "审批已通过，等待出纳付款。");

  // 没选付款单位时说清楚，无合同时不显示余额
  resetState();
  state.payment = {
    ...basePayment(),
    payment_entity_id: null,
    payment_entity: null,
    payment_account: null,
    contract_id: null,
    contract: null
  };
  page = await openPage();
  assert.strictEqual(factValue(page, "付款单位"), "尚未指定");
  assert.strictEqual(rowValue(page, "付款账户"), "尚未指定");
  assert.strictEqual(rowValue(page, "关联合同"), "无合同 / 无需合同");
  assert.strictEqual(rowValue(page, "剩余额度"), undefined);

  // 历史数据
  resetState();
  state.payment = { ...basePayment(), legacy_data_id: "LG-1" };
  page = await openPage();
  assert.strictEqual(page.data.detail.isLegacy, true);

  // 付款单加载失败：错误态，不是空白页
  resetState();
  state.paymentFails = true;
  page = await openPage();
  assert.strictEqual(page.data.detailState, "error");
  assert.strictEqual(page.data.detail, null);
  assert.strictEqual(page.data.detailErrorText, "付款单不存在或无权限");

  // 无查询权限的角色直接进入被拦
  resetState();
  state.profile = { username: "me", roles: ["operator"] };
  page = await openPage();
  assert.strictEqual(state.toasts[0], "当前角色无查询权限");
  assert.strictEqual(page.data.detail, null);
  await flush();
  assert.strictEqual(state.backs, 1);

  // 从审批详情过来不拦：发起人和审批人不一定有查询权限；也不再链回审批详情
  resetState();
  state.profile = { username: "me", roles: ["operator"] };
  page = await openPage({ from: "approval" });
  assert.strictEqual(page.data.detailState, "ready");
  assert.deepStrictEqual(state.toasts, []);
  assert.strictEqual(page.data.showApprovalLink, false);

  // 参数错误
  resetState();
  page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch) {
      this.data = { ...this.data, ...patch };
    }
  };
  await page.onLoad({});
  assert.strictEqual(state.toasts[0], "参数错误");

  console.log("payment-detail-page.test.js: ok");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
