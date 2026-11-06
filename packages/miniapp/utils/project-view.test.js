/** 项目列表和项目详情的视图模型。运行：node utils/project-view.test.js */
const assert = require("assert");
const {
  buildProjectFacts,
  buildFinanceRows,
  buildLogRows,
  buildProjectCard,
  buildSectionCards,
  buildStageBar,
  canReviewExternalLogs,
  isSystemProject,
  parseBriefing,
  cleanRichText
} = require("./project-view");

const toName = (id) => ({ XiaoLianZhong: "肖连中" })[id] || id;

// ── 项目交底 ──
assert.deepStrictEqual(parseBriefing(null), { mode: "empty", text: "", rows: [] });
assert.deepStrictEqual(parseBriefing("  \n "), { mode: "empty", text: "", rows: [] });

// 线上真实写法：分号隔开的「项：内容」
const structured = parseBriefing(
  "开工日期：大约5月初；施工范围：管道顶进、管外壁注水泥浆、进出洞高压旋喷桩加固；顶进方式：卵石破碎顶管；管径：DN2000钢管"
);
assert.strictEqual(structured.mode, "rows");
assert.deepStrictEqual(
  structured.rows.map((row) => [row.label, row.value]),
  [
    ["开工日期", "大约5月初"],
    ["施工范围", "管道顶进、管外壁注水泥浆、进出洞高压旋喷桩加固"],
    ["顶进方式", "卵石破碎顶管"],
    ["管径", "DN2000钢管"]
  ]
);

// 线上真实写法：一段话，只有开头一个冒号。不能把整段都算成「顶进方式」的内容
const prose =
  "顶进方式：泥水平衡，全长89米，管径D2000钢筋砼三级管，接口钢承口，管节长度2.5米，地质为砂层，有地下水。进场时间为10月25日，完成时间为11月10日。";
assert.deepStrictEqual(parseBriefing(prose), { mode: "text", text: prose, rows: [] });

// 分行写的也要拆开；没有冒号的那行原样保留，一个字都不能丢
const lines = parseBriefing("地质：砂层\n管径：D2000\n注意地下水");
assert.strictEqual(lines.mode, "rows");
assert.deepStrictEqual(
  lines.rows.map((row) => [row.label, row.value]),
  [
    ["地质", "砂层"],
    ["管径", "D2000"],
    ["", "注意地下水"]
  ]
);

// 历史数据里有 HTML
const html = parseBriefing("<p>地质：砂层</p><p>管径：D2000&nbsp;钢管</p>");
assert.deepStrictEqual(
  html.rows.map((row) => [row.label, row.value]),
  [
    ["地质", "砂层"],
    ["管径", "D2000 钢管"]
  ]
);

// 内容里的英文冒号（时间）不能被当成分隔
const timed = parseBriefing("进场：上午10:30；地质：砂层");
assert.strictEqual(timed.rows[0].value, "上午10:30");

// 冒号前面太长就不是标签，不硬拆
const longLabel = "根据现场踏勘结果判断地质情况：砂层；管径：D2000";
assert.deepStrictEqual(parseBriefing(longLabel), { mode: "text", text: longLabel, rows: [] });

// 结尾多余的分号不产生空行
assert.strictEqual(parseBriefing("地质：砂层；管径：D2000；").rows.length, 2);

// 没有任何冒号，保留原有换行
assert.deepStrictEqual(parseBriefing("用于非项目支出"), {
  mode: "text",
  text: "用于非项目支出",
  rows: []
});
assert.strictEqual(parseBriefing("第一行\n第二行").text, "第一行\n第二行");

assert.strictEqual(cleanRichText("甲<br/>乙<div>丙</div>&amp;丁"), "甲\n乙\n丙\n&丁");

// ── 项目阶段 ──
const stateOf = (status) => buildStageBar(status).map((stage) => stage.state);
assert.deepStrictEqual(stateOf("active"), ["past", "past", "current", "todo", "todo"]);
assert.deepStrictEqual(stateOf("planning"), ["current", "todo", "todo", "todo", "todo"]);
assert.deepStrictEqual(stateOf("archived"), ["past", "past", "past", "past", "current"]);
assert.deepStrictEqual(stateOf("whatever"), ["todo", "todo", "todo", "todo", "todo"]);
assert.deepStrictEqual(
  buildStageBar("active").map((stage) => stage.label),
  ["规划", "筹备", "施工", "收尾", "归档"]
);

// ── 系统占位项目 ──
assert.strictEqual(isSystemProject({ project_code: "办公室", project_name: "办公室" }), true);
assert.strictEqual(isSystemProject({ project_code: "PRJ-1", project_name: "仓库" }), true);
assert.strictEqual(isSystemProject({ project_code: "PRJ-1", project_name: "仓库搬迁工程" }), false);

// ── 列表卡片 ──
const rawProject = {
  id: 4699,
  project_code: "PRJ-20260327-100640",
  project_name: "26-07丰台区黄土岗蓄滞洪区建设工程",
  manager_userid: "XiaoLianZhong",
  status: "active",
  location_text: "北京市丰台区黄土岗",
  project_start_at: "2026-03-27T02:17:44.376Z"
};
const asManager = { username: "other", roles: ["manager"] };
const card = buildProjectCard(rawProject, { toName, profile: asManager });
assert.strictEqual(card.statusText, "施工中");
assert.strictEqual(card.statusTheme, "success");
assert.strictEqual(card.managerName, "肖连中");
assert.strictEqual(card.startDate, "2026-03-27");
assert.strictEqual(card.location, "北京市丰台区黄土岗");
assert.strictEqual(card.readonly, false);
assert.strictEqual(card.archived, false);

// 操作手：只有自己负责的项目能写
const asOperator = { username: "XiaoLianZhong", roles: ["operator"] };
assert.strictEqual(buildProjectCard(rawProject, { toName, profile: asOperator }).readonly, false);
const asOther = { username: "someone", roles: ["operator"] };
assert.strictEqual(buildProjectCard(rawProject, { toName, profile: asOther }).readonly, true);

const sparse = buildProjectCard(
  { id: 1, project_name: "无资料项目", status: "archived", manager_userid: null },
  { toName, profile: asManager }
);
assert.strictEqual(sparse.managerName, "未指定");
assert.strictEqual(sparse.startDate, "");
assert.strictEqual(sparse.location, "");
assert.strictEqual(sparse.archived, true);
assert.strictEqual(sparse.statusTheme, "default");

// ── 详情头部的资料 ──
const facts = buildProjectFacts(
  { ...rawProject, end_date: "2026-12-31", project_kind: "external", external_party_name: "某市政" },
  toName
);
assert.deepStrictEqual(
  facts.map((row) => [row.label, row.value]),
  [
    ["项目经理", "肖连中"],
    ["开工日期", "2026-03-27"],
    ["计划完工", "2026-12-31"],
    ["项目位置", "北京市丰台区黄土岗"],
    ["外部单位", "某市政"]
  ]
);
// 没填的如实说没填，选填项没有就不占位置
const bareFacts = buildProjectFacts({ status: "planning", manager_userid: null }, toName);
assert.deepStrictEqual(
  bareFacts.map((row) => [row.label, row.value]),
  [
    ["项目经理", "未指定"],
    ["开工日期", "未设置"],
    ["项目位置", "未填写"]
  ]
);

// ── 标段 ──
const sections = [
  { id: 1, section_code: "A", section_name: "一标段", status: "active", section_length: 200 },
  { id: 2, section_code: "B", section_name: "二标段", status: "normal", section_length: 0 },
  { id: 3, section_code: "C", section_name: "", status: "done", section_length: 100 }
];
const operatorLogs = [
  // 每天都填累计进尺，累计取最大值，不能把累计值加起来
  { section_id: 1, log_date: "2026-11-01", footage_m: 5, cumulative_footage_m: 50 },
  { section_id: 1, log_date: "2026-11-03", footage_m: 7, cumulative_footage_m: 57 },
  { section_id: 1, log_date: "2026-11-02", footage_m: 2, cumulative_footage_m: 52 },
  // 没填累计时才用当日进尺相加
  { section_id: 2, log_date: "2026-10-01", footage_m: 3.5, cumulative_footage_m: null },
  { section_id: 2, log_date: "2026-10-02", footage_m: 1.5, cumulative_footage_m: null },
  // 超出总长
  { section_id: 3, log_date: "2026-09-01", footage_m: 0, cumulative_footage_m: 130 }
];
const reports = [{ section_id: 3 }, { section_id: 3 }];
const [one, two, three] = buildSectionCards(sections, operatorLogs, reports);

assert.strictEqual(one.title, "A 一标段");
assert.strictEqual(one.statusText, "施工中");
assert.strictEqual(one.footageText, "57 / 200 m");
assert.strictEqual(one.percent, 28.5);
assert.strictEqual(one.latestText, "最近更新 2026-11-03");
assert.strictEqual(one.breakthroughCount, 0);

// 没有总长算不出比例，不能显示成 0%
assert.strictEqual(two.statusText, "正常");
assert.strictEqual(two.footageText, "5 m");
assert.strictEqual(two.percent, null);

assert.strictEqual(three.title, "C 未命名标段");
assert.strictEqual(three.percent, 100);
assert.strictEqual(three.footageText, "130 / 100 m");
assert.strictEqual(three.breakthroughCount, 2);

const [empty] = buildSectionCards([sections[0]], [], []);
assert.strictEqual(empty.footageText, "0 / 200 m");
assert.strictEqual(empty.percent, 0);
assert.strictEqual(empty.latestText, "还没有施工日志");

// 施工日志没取到时，进度是未知，不是 0
const [failedCard] = buildSectionCards([sections[0]], [], [], [1]);
assert.strictEqual(failedCard.percent, null);
assert.strictEqual(failedCard.footageText, "");
assert.strictEqual(failedCard.latestText, "进度没有取到，下拉刷新重试");

// ── 项目日志 ──
const logs = buildLogRows(
  [
    { id: 1, log_date: "2026-10-01", status: "draft", title: "", detail_html: "", manager_userid: "x" },
    {
      id: 2,
      log_date: "2026-11-02T00:00:00Z",
      status: "submitted",
      title: "顶进第一天",
      detail_html: "<p>今日顶进</p><p>两节</p>",
      risk_note: "注意涌水",
      manager_userid: "XiaoLianZhong",
      photos: [{ file_url: "https://x/1.jpg", file_name: "现场" }, { file_name: "没有地址" }]
    }
  ],
  toName
);
assert.deepStrictEqual(logs.map((row) => row.id), [2, 1]);
assert.strictEqual(logs[0].dayText, "2026-11-02");
assert.strictEqual(logs[0].statusText, "已提交");
assert.strictEqual(logs[0].detailText, "今日顶进\n两节");
assert.strictEqual(logs[0].managerName, "肖连中");
assert.deepStrictEqual(logs[0].photoUrls, ["https://x/1.jpg"]);
assert.strictEqual(logs[1].title, "未命名日志");
assert.strictEqual(logs[1].statusText, "草稿");

// ── 财务 ──
assert.strictEqual(buildFinanceRows(null), null);
assert.deepStrictEqual(
  buildFinanceRows({
    outboundPaidAmount: 1234567.891,
    reimbursementAmount: 0,
    inboundInvoicedAmount: 100,
    inboundReceivedAmount: null
  }).map((row) => [row.label, row.value]),
  [
    ["对外已付", "¥1,234,567.89"],
    ["报销累计", "¥0.00"],
    ["收款已开票", "¥100.00"],
    ["收款已到账", "-"]
  ]
);

// ── 外部日志复核权限 ──
const managed = { manager_userid: "me" };
assert.strictEqual(canReviewExternalLogs(managed, { username: "x", roles: ["super_admin"] }), true);
assert.strictEqual(canReviewExternalLogs(managed, { username: "me", roles: ["site_manager"] }), true);
assert.strictEqual(canReviewExternalLogs(managed, { username: "x", roles: ["manager"] }), false);
assert.strictEqual(canReviewExternalLogs(managed, { username: "me", roles: ["operator"] }), false);
assert.strictEqual(canReviewExternalLogs(null, { username: "x", roles: ["super_admin"] }), true);

console.log("project-view: ok");
