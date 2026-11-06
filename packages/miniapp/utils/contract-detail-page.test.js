/**
 * 合同详情页的流程测试：真实页面代码 + 真实视图模型，只替换接口、登录态和 wx。
 * 电脑模拟器登录不通，这里只能检查页面数据，界面仍要真机验证。
 */
const assert = require("assert");
const path = require("path");

const realSetTimeout = setTimeout;
global.setTimeout = (fn) => realSetTimeout(fn, 0);
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 5));

const CONTRACT_ID = 17;
const INSTANCE_ID = 201;

const state = {};

const baseContract = () => ({
  id: CONTRACT_ID,
  contract_no: "HT-20260220-0001",
  direction: "outbound",
  status: "active",
  project_id: 65,
  project: { project_name: "顶管一期", project_code: "P-65" },
  entity_id: 13,
  entity: { entity_name: "恒越劳务" },
  counterparty: "鑫丰畅劳务",
  contract_type: "labor",
  handler_userid: "starter",
  contract_date: "2026-02-20",
  total_amount: 1200000,
  paid_amount: 380000,
  received_amount: 0,
  invoiced_amount: 0,
  approval_instance_id: INSTANCE_ID,
  ai_review_status: "completed",
  ai_review_result: JSON.stringify({ summary: "条款完整", overall_risk: "low" }),
  attachments_json: JSON.stringify([{ file_key: "contract/a", file_name: "合同.pdf", file_size: 2048 }]),
  remark: "正文\n[超管修改 2026-10-01T02:03:04.000Z] starter：改了对方单位",
  created_at: "2026-02-20T00:00:00.000Z",
  updated_at: "2026-02-21T00:00:00.000Z",
  amount_changes: [
    {
      id: 5,
      change_type: "adjust",
      old_amount: 1000000,
      new_amount: 1200000,
      reason: "加量",
      status: "pending",
      approval_instance_id: 9,
      approval_status: "in_progress",
      applicant_userid: "starter",
      attachments: [{ file_key: "contract/b", file_name: "补充协议.pdf", file_size: 1024, file_url: "/x" }],
      created_at: "2026-03-01T00:00:00.000Z"
    },
    {
      id: 4,
      change_type: "increase",
      old_amount: 900000,
      new_amount: 1000000,
      reason: "第一次",
      status: "approved",
      approval_instance_id: 8,
      approval_status: "approved",
      applicant_userid: "boss",
      attachments: [],
      created_at: "2026-02-25T00:00:00.000Z"
    }
  ],
  payment_requests: [
    { id: 55, serial_no: "SP-1", amount: 380000, status: "paid", created_at: "2026-03-02T00:00:00.000Z" },
    { id: 56, serial_no: "SP-2", amount: 100, status: "cancelled", created_at: "2026-03-03T00:00:00.000Z" }
  ]
});

const baseApproval = () => ({
  instance: { id: INSTANCE_ID, status: "approved", current_node_key: null, current_round: 1 },
  nodes: [
    { id: 11, node_key: "node_a", node_name: "AI审核", node_type: "ai_gate", round: 1, sort_order: 1, status: "completed" }
  ],
  tasks: [
    {
      id: 1,
      node_instance_id: 11,
      assignee_userid: "AI_GATE",
      status: "completed",
      action: "approve",
      comment: "AI审查通过：条款完整"
    }
  ],
  ai_gate_reviews: [
    {
      task_id: 1,
      node_key: "node_a",
      status: "completed",
      decision: "pass",
      summary: "条款完整",
      comment: "AI审查通过：条款完整",
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
  state.documents = [];
  state.profile = { username: "me", roles: ["finance"] };
  state.contract = baseContract();
  state.approval = baseApproval();
  state.receipts = [];
  state.contractFails = false;
  state.approvalFails = false;
  state.receiptsFail = false;
};

const respond = (options) => {
  const { path: url } = options;
  state.calls.push(url);
  if (url === `/api/v1/contract/${CONTRACT_ID}`) {
    if (state.contractFails) throw new Error("合同不存在");
    return { data: state.contract };
  }
  if (url === `/api/v1/approval/${INSTANCE_ID}`) {
    if (state.approvalFails) throw new Error("无权限");
    return { data: state.approval };
  }
  if (url.indexOf("/api/v1/receipt?") === 0) {
    if (state.receiptsFail) throw new Error("收款加载失败");
    return { data: state.receipts, pagination: { total: state.receipts.length } };
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
  previewImage: () => {},
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
require("../pages/query-contract-detail/index.js");

const openPage = async (options = {}) => {
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch, callback) {
      this.data = { ...this.data, ...patch };
      if (callback) callback();
    }
  };
  await page.onLoad({ id: String(CONTRACT_ID), ...options });
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
  // ── 付款合同 ──
  resetState();
  let page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.deepStrictEqual(state.toasts, []);

  // 头部：多少钱、和谁签、什么合同
  assert.strictEqual(page.data.detail.amountLabel, "合同金额");
  assert.strictEqual(page.data.detail.amountText, "1,200,000.00");
  assert.strictEqual(page.data.detail.amountCn, "壹佰贰拾万元整");
  assert.strictEqual(page.data.detail.title, "鑫丰畅劳务 · 人工");
  assert.strictEqual(page.data.detail.contractNo, "HT-20260220-0001");
  assert.strictEqual(page.data.detail.statusText, "生效中");
  assert.strictEqual(factValue(page, "我方主体"), "恒越劳务");
  assert.strictEqual(factValue(page, "所属项目"), "顶管一期");
  assert.strictEqual(factValue(page, "经办人"), "张三");

  // 不再拉全量项目列表，也不查收款
  assert.ok(!state.calls.some((url) => url.indexOf("/api/v1/project") === 0));
  assert.ok(!state.calls.some((url) => url.indexOf("/api/v1/receipt") === 0));

  // 付款进度和余额
  assert.deepStrictEqual(
    page.data.detail.progress.map((item) => [item.label, item.doneText, item.percent, item.over]),
    [["已付款", "380,000.00", 32, false]]
  );
  assert.strictEqual(page.data.detail.remainText, "剩余 820,000.00 元");

  // 明细：备注只留经办人写的；进度已在头部，不再重复
  assert.strictEqual(rowValue(page, "方向"), "对外付款合同");
  assert.strictEqual(rowValue(page, "备注"), "正文");
  assert.strictEqual(rowValue(page, "已付金额"), undefined);
  assert.strictEqual(page.data.detail.remarkEdits.length, 1);
  assert.strictEqual(page.data.detail.remarkEdits[0].byText, "张三");

  // AI：合同审查报告 + 关卡结论
  assert.strictEqual(page.data.aiVisible, true);
  assert.strictEqual(page.data.ai.latest.verdictLabel, "建议通过");
  assert.strictEqual(page.data.aiReportTitle, "合同审查报告");
  assert.strictEqual(page.data.aiReportOpen, false);

  // 金额变更：待提交但审批在跑时要写审批中
  const [running, approved] = page.data.detail.amountChanges;
  assert.strictEqual(running.statusText, "审批中");
  assert.strictEqual(running.statusTheme, "warning");
  assert.strictEqual(running.amountText, "1,000,000.00 → 1,200,000.00");
  assert.strictEqual(running.typeText, "调整");
  assert.strictEqual(running.applicantText, "张三");
  assert.strictEqual(running.attachments[0].extLabel, "PDF");
  assert.strictEqual(approved.statusText, "已通过");
  assert.strictEqual(approved.typeText, "增加");

  // 关联付款：作废的不计入合计
  assert.strictEqual(page.data.detail.payments.length, 2);
  assert.strictEqual(page.data.detail.payments[1].statusText, "已废止");
  assert.strictEqual(page.data.detail.paymentSummary, "共 2 笔，有效合计 380,000.00 元");
  assert.strictEqual(page.data.detail.isInbound, false);

  // 流程和跳转
  assert.strictEqual(page.data.timelineNodes.length, 1);
  assert.strictEqual(page.data.showApprovalLink, true);
  page.openApprovalDetail();
  assert.strictEqual(
    state.navigations[0],
    `/pages/approval-detail/index?id=${INSTANCE_ID}&readonly=1&from=query-contract`
  );
  page.openPaymentDetail({ currentTarget: { dataset: { id: 55 } } });
  assert.strictEqual(state.navigations[1], "/pages/query-payment-detail/index?id=55&from=contract");

  // 附件：受保护前缀走签名地址，返回不重新请求
  await page.openAttachment({
    currentTarget: { dataset: { key: "contract/a", name: "合同.pdf", url: "" } }
  });
  await flush();
  assert.deepStrictEqual(state.documents, ["/tmp/doc.pdf"]);
  const callsBefore = state.calls.length;
  await page.onShow();
  assert.strictEqual(state.calls.length, callsBefore);

  // ── 收款合同：开票、到账进度和收款记录，不查付款 ──
  resetState();
  state.contract = {
    ...baseContract(),
    direction: "inbound",
    total_amount: 1000,
    paid_amount: 0,
    invoiced_amount: 1200,
    received_amount: 400,
    payment_requests: []
  };
  state.receipts = [
    { id: 7, receipt_no: "RC-7", amount: 400, status: "recorded", receiver_userid: "boss", received_date: "2026-04-01" },
    { id: 8, receipt_no: "RC-8", amount: 50, status: "refunded", receiver_userid: "boss", received_date: "2026-04-02" }
  ];
  page = await openPage();
  assert.strictEqual(page.data.detail.isInbound, true);
  assert.strictEqual(rowValue(page, "方向"), "对外收款合同");
  assert.deepStrictEqual(
    page.data.detail.progress.map((item) => [item.label, item.doneText, item.percent, item.over]),
    [
      ["已开票", "1,200.00", 100, true],
      ["已到账", "400.00", 40, false]
    ]
  );
  assert.strictEqual(page.data.detail.remainText, "");
  assert.deepStrictEqual(
    page.data.receipts.map((item) => [item.receiptNo, item.amountText, item.statusText, item.receiverText]),
    [
      ["RC-7", "400.00", "已登记", "李总"],
      ["RC-8", "50.00", "已退款", "李总"]
    ]
  );
  assert.strictEqual(page.data.canOpenReceipt, true);
  page.openReceiptDetail({ currentTarget: { dataset: { id: 7 } } });
  assert.strictEqual(state.navigations[0], "/pages/query-receipt-detail/index?id=7");

  // 收款列表取不到不挡合同本身
  resetState();
  state.contract = { ...baseContract(), direction: "inbound", payment_requests: [] };
  state.receiptsFail = true;
  page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.deepStrictEqual(page.data.receipts, []);

  // ── 总额为 0 的单价合同：不显示百分比和余额，避免误导 ──
  resetState();
  state.contract = { ...baseContract(), total_amount: 0, paid_amount: 5000 };
  page = await openPage();
  assert.strictEqual(page.data.detail.progress[0].percent, null);
  assert.strictEqual(page.data.detail.progress[0].doneText, "5,000.00");
  assert.strictEqual(page.data.detail.remainText, "");

  // ── 未提审：没有流程，也不打审批接口；没审查过不显示 AI 卡片 ──
  resetState();
  state.contract = {
    ...baseContract(),
    status: "draft",
    approval_instance_id: null,
    ai_review_status: "none",
    ai_review_result: null
  };
  page = await openPage();
  assert.strictEqual(page.data.detail.statusText, "草稿");
  assert.strictEqual(page.data.aiVisible, false);
  assert.strictEqual(page.data.timelineNodes.length, 0);
  assert.strictEqual(page.data.showApprovalLink, false);
  assert.strictEqual(page.data.approvalUnavailable, false);
  assert.ok(!state.calls.some((url) => url.indexOf("/api/v1/approval/") === 0));

  // ── 只有审查报告：卡片显示，报告默认展开 ──
  resetState();
  state.contract = { ...baseContract(), status: "draft", approval_instance_id: null };
  page = await openPage();
  assert.strictEqual(page.data.aiVisible, true);
  assert.strictEqual(page.data.aiReportOpen, true);

  // ── 审批详情只对参与人开放：说清楚看不到，也不给打不开的入口 ──
  resetState();
  state.approvalFails = true;
  page = await openPage();
  assert.strictEqual(page.data.detailState, "ready");
  assert.strictEqual(page.data.approvalUnavailable, true);
  assert.strictEqual(page.data.showApprovalLink, false);

  // ── 退回：原因写在头部，流程默认展开 ──
  resetState();
  state.contract = { ...baseContract(), status: "draft" };
  state.approval = {
    ...baseApproval(),
    instance: { ...baseApproval().instance, status: "returned" },
    nodes: [
      { id: 12, node_key: "fin", node_name: "财务审批", node_type: "sequential", round: 1, sort_order: 1, status: "completed" }
    ],
    tasks: [
      {
        id: 2,
        node_instance_id: 12,
        assignee_userid: "boss",
        status: "completed",
        action: "return_initiator",
        comment: "付款条款要改",
        acted_at: "2026-03-03T00:00:00.000Z"
      }
    ],
    ai_gate_reviews: []
  };
  page = await openPage();
  assert.strictEqual(page.data.stopReasonText, "退回原因：付款条款要改");
  assert.strictEqual(page.data.stopIsReturned, true);
  assert.strictEqual(page.data.flowCollapsed, false);

  // ── 历史数据、未知状态 ──
  resetState();
  state.contract = { ...baseContract(), legacy_data_id: "LG-1", status: "whatever" };
  page = await openPage();
  assert.strictEqual(page.data.detail.isLegacy, true);
  assert.strictEqual(page.data.detail.statusText, "未知");

  // ── 合同加载失败：错误态，不是空白页 ──
  resetState();
  state.contractFails = true;
  page = await openPage();
  assert.strictEqual(page.data.detailState, "error");
  assert.strictEqual(page.data.detail, null);
  assert.strictEqual(page.data.detailErrorText, "合同不存在或无权限");

  // ── 无查询权限的角色直接进入被拦 ──
  resetState();
  state.profile = { username: "me", roles: ["operator"] };
  page = await openPage();
  assert.strictEqual(state.toasts[0], "当前角色无查询权限");
  assert.strictEqual(page.data.detail, null);
  await flush();
  assert.strictEqual(state.backs, 1);

  // ── 从审批详情过来不拦：审批人不一定有查询权限；不再链回审批详情 ──
  resetState();
  state.profile = { username: "me", roles: ["site_manager"] };
  page = await openPage({ from: "approval" });
  assert.strictEqual(page.data.detailState, "ready");
  assert.deepStrictEqual(state.toasts, []);
  assert.strictEqual(page.data.showApprovalLink, false);
  // 收款详情仍限查询角色，点进去只会被拦，这种情况不给入口
  assert.strictEqual(page.data.canOpenReceipt, false);
  page.openPaymentDetail({ currentTarget: { dataset: { id: 55 } } });
  assert.strictEqual(state.navigations[0], "/pages/query-payment-detail/index?id=55&from=approval");

  // ── 参数错误 ──
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

  console.log("contract-detail-page.test.js: ok");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
