/** 「我的车辆记录」视图模型测试。运行：node utils/vehicle-records-view.test.js */
const assert = require("assert");

const {
  FUEL_STATUS_FILTERS,
  MAINTENANCE_STATUS_FILTERS,
  buildFuelCard,
  buildFuelDetail,
  buildMaintenanceCard,
  buildMaintenanceDetail,
  buildTypeMap
} = require("../packageFinance/common/vehicle-records-view");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const fuelRow = (fields = {}) => ({
  id: 12,
  application_no: "FQ-20261108-0001",
  applicant_userid: "driver-a",
  vehicle_id: 3,
  fuel_card_id: 5,
  requested_amount: 1500,
  vehicle_mileage_km: 123456.7,
  photo_keys_json: '["fuel-application/1731-uuid-tmp_abc.jpg","fuel-application/1732-uuid-tmp_def.png"]',
  status: "pending",
  requested_at: "2026-11-08T01:05:00.000Z",
  processed_by_userid: null,
  processed_at: null,
  office_remark: null,
  latest_card_balance: null,
  risk_summary: null,
  needs_info_reason: null,
  resubmitted_at: null,
  supplement_count: 0,
  current_plate_no: "粤B12345",
  vehicle_model: "五菱宏光",
  card_no: "CARD-001",
  ...fields
});

const maintenanceRow = (fields = {}) => ({
  id: 7,
  record_no: "VM-20261101-0003",
  vehicle_id: 3,
  maintenance_type: "routine",
  content: "更换机油、机滤",
  mileage_km: 98000,
  service_provider: "城东修理厂",
  cost: 680,
  serviced_at: "2026-11-01",
  attachments_json: JSON.stringify([
    { file_key: "vehicle-maintenance/a.jpg", file_name: "发票.jpg", file_size: 2048 },
    { file_key: "vehicle-maintenance/b.pdf", file_name: "结算单.pdf", file_size: 0 }
  ]),
  remark: null,
  status: "active",
  created_by_userid: "driver-a",
  voided_by_userid: null,
  voided_at: null,
  void_reason: null,
  created_at: "2026-11-01T09:30:00.000Z",
  current_plate_no: "粤B12345",
  vehicle_model: null,
  ...fields
});

const labelsOf = (rows) => rows.map((row) => row.label);
const valueOf = (rows, label) => (rows.find((row) => row.label === label) || {}).value;

test("筛选项：全部状态在最前，油卡五种、保养两种", () => {
  assert.deepStrictEqual(FUEL_STATUS_FILTERS.map((item) => item.value), [
    "",
    "pending",
    "needs_info",
    "processed",
    "rejected",
    "cancelled"
  ]);
  assert.deepStrictEqual(MAINTENANCE_STATUS_FILTERS.map((item) => item.label), ["全部状态", "有效", "已作废"]);
});

test("油卡列表卡片：额度、车牌、里程、北京时间", () => {
  const card = buildFuelCard(fuelRow());
  assert.strictEqual(card.title, "FQ-20261108-0001");
  assert.strictEqual(card.statusLabel, "待办公室处理");
  assert.strictEqual(card.amountText, "1,500.00 元");
  assert.strictEqual(card.metaText, "粤B12345 ｜ 123,456.7 km");
  assert.strictEqual(card.timeText, "申请于 2026-11-08 09:05");
  assert.strictEqual(card.noteText, "");
});

test("油卡列表卡片：待补充时带出原因，别的状态不带", () => {
  const needsInfo = buildFuelCard(fuelRow({ status: "needs_info", needs_info_reason: "照片看不清仪表盘" }));
  assert.strictEqual(needsInfo.statusLabel, "待补充资料");
  assert.strictEqual(needsInfo.statusTheme, "warning");
  assert.strictEqual(needsInfo.noteText, "照片看不清仪表盘");
  const processed = buildFuelCard(fuelRow({ status: "processed", needs_info_reason: "旧原因" }));
  assert.strictEqual(processed.noteText, "");
});

test("油卡列表卡片：未知状态和缺字段不报错", () => {
  const card = buildFuelCard({ id: 3, status: "weird" });
  assert.strictEqual(card.title, "油卡申请 3");
  assert.strictEqual(card.statusLabel, "未知状态");
  assert.strictEqual(card.amountText, "-");
  assert.strictEqual(card.metaText, "- ｜ -");
  assert.strictEqual(card.timeText, "申请于 -");
});

test("油卡详情：没处理时不显示处理信息，照片按顺序命名、按图片打开", () => {
  const detail = buildFuelDetail(fuelRow(), {});
  assert.strictEqual(detail.amountText, "1,500.00");
  assert.deepStrictEqual(labelsOf(detail.facts), ["车辆", "油卡", "里程", "申请时间"]);
  assert.strictEqual(valueOf(detail.facts, "车辆"), "粤B12345 · 五菱宏光");
  assert.strictEqual(detail.handled, false);
  assert.deepStrictEqual(detail.handleFacts, []);
  assert.strictEqual(detail.canResubmit, false);
  assert.deepStrictEqual(
    detail.photos.map((item) => [item.file_key, item.file_name, item.openName]),
    [
      ["fuel-application/1731-uuid-tmp_abc.jpg", "现场照片 1", "现场照片 1.jpg"],
      ["fuel-application/1732-uuid-tmp_def.png", "现场照片 2", "现场照片 2.jpg"]
    ]
  );
});

test("油卡详情：已通过时显示处理人姓名、备注和处理后余额", () => {
  const detail = buildFuelDetail(
    fuelRow({
      status: "processed",
      processed_by_userid: "ZhangSan",
      processed_at: "2026-11-08T03:00:00.000Z",
      office_remark: "已充值",
      latest_card_balance: 1820.5,
      risk_summary: "本月第 3 次申请"
    }),
    { ZhangSan: "张三" }
  );
  assert.strictEqual(detail.statusLabel, "已通过");
  assert.strictEqual(detail.handled, true);
  assert.deepStrictEqual(
    detail.handleFacts.map((row) => [row.label, row.value]),
    [
      ["处理人", "张三"],
      ["处理时间", "2026-11-08 11:00"],
      ["办公室备注", "已充值"],
      ["处理后余额", "1,820.50 元"]
    ]
  );
  assert.strictEqual(detail.riskSummary, "本月第 3 次申请");
});

test("油卡详情：处理人不在通讯录时不露拼音账号", () => {
  const detail = buildFuelDetail(
    fuelRow({ status: "rejected", processed_by_userid: "LiSi", processed_at: "2026-11-08T03:00:00.000Z" }),
    {}
  );
  assert.strictEqual(valueOf(detail.handleFacts, "处理人"), "办公室");
  assert.strictEqual(valueOf(detail.handleFacts, "处理后余额"), undefined);
});

test("油卡详情：待补充时可以去补充，补充次数带最近时间", () => {
  const detail = buildFuelDetail(
    fuelRow({
      status: "needs_info",
      needs_info_reason: "补一张仪表盘照片",
      processed_at: "2026-11-08T02:00:00.000Z",
      supplement_count: 2,
      resubmitted_at: "2026-11-07T12:00:00.000Z"
    }),
    {}
  );
  assert.strictEqual(detail.canResubmit, true);
  assert.strictEqual(detail.needsInfoReason, "补一张仪表盘照片");
  assert.strictEqual(valueOf(detail.facts, "补充次数"), "2 次（最近 2026-11-07 20:00）");
});

test("油卡详情：要求补充时办公室备注和补充原因一样就不重复显示", () => {
  const same = buildFuelDetail(
    fuelRow({
      status: "needs_info",
      needs_info_reason: "补一张仪表盘照片",
      office_remark: "补一张仪表盘照片",
      processed_by_userid: "ZhangSan",
      processed_at: "2026-11-08T02:00:00.000Z"
    }),
    { ZhangSan: "张三" }
  );
  assert.deepStrictEqual(labelsOf(same.handleFacts), ["处理人", "处理时间"]);
  const different = buildFuelDetail(
    fuelRow({
      status: "needs_info",
      needs_info_reason: "补一张仪表盘照片",
      office_remark: "上次的照片是别的车",
      processed_at: "2026-11-08T02:00:00.000Z"
    }),
    {}
  );
  assert.strictEqual(valueOf(different.handleFacts, "办公室备注"), "上次的照片是别的车");
});

test("油卡详情：补充后重新提交回到待处理，上一轮的处理信息不算已处理", () => {
  const detail = buildFuelDetail(
    fuelRow({
      status: "pending",
      processed_by_userid: "ZhangSan",
      processed_at: "2026-11-08T02:00:00.000Z",
      office_remark: "补一张仪表盘照片",
      supplement_count: 1,
      resubmitted_at: "2026-11-08T04:00:00.000Z"
    }),
    { ZhangSan: "张三" }
  );
  assert.strictEqual(detail.handled, false);
  assert.deepStrictEqual(detail.handleFacts, []);
  assert.strictEqual(detail.canResubmit, false);
  assert.strictEqual(valueOf(detail.facts, "补充次数"), "1 次（最近 2026-11-08 12:00）");
});

test("列表卡片：没有金额时标记为空，用浅色显示", () => {
  assert.strictEqual(buildFuelCard(fuelRow()).amountEmpty, false);
  assert.strictEqual(buildMaintenanceCard({ id: 1, cost: null }, {}).amountEmpty, true);
  assert.strictEqual(buildMaintenanceCard({ id: 1, cost: 0 }, {}).amountEmpty, false);
});

test("油卡详情：照片字段坏了或为空时没有照片", () => {
  assert.deepStrictEqual(buildFuelDetail(fuelRow({ photo_keys_json: "not json" }), {}).photos, []);
  assert.deepStrictEqual(buildFuelDetail(fuelRow({ photo_keys_json: null }), {}).photos, []);
});

test("保养类型字典：值到中文，坏数据跳过", () => {
  const map = buildTypeMap([
    { dict_value: "routine", dict_label: "常规保养" },
    { dict_label: "没有值" },
    null
  ]);
  assert.deepStrictEqual(map, { routine: "常规保养" });
  assert.deepStrictEqual(buildTypeMap(null), {});
});

test("保养列表卡片：费用、车牌、类型、里程、日期", () => {
  const card = buildMaintenanceCard(maintenanceRow(), { routine: "常规保养" });
  assert.strictEqual(card.title, "VM-20261101-0003");
  assert.strictEqual(card.statusLabel, "有效");
  assert.strictEqual(card.amountText, "680.00 元");
  assert.strictEqual(card.metaText, "粤B12345 ｜ 常规保养 ｜ 98,000 km");
  assert.strictEqual(card.timeText, "保养日期 2026-11-01");
});

test("保养列表卡片：没填费用、字典缺类型、日期是完整时间", () => {
  const card = buildMaintenanceCard(
    maintenanceRow({ cost: null, maintenance_type: "tire", serviced_at: "2026-10-31T20:00:00.000Z" }),
    {}
  );
  assert.strictEqual(card.amountText, "未填费用");
  assert.strictEqual(card.metaText, "粤B12345 ｜ tire ｜ 98,000 km");
  assert.strictEqual(card.timeText, "保养日期 2026-11-01");
});

test("保养详情：有效记录不显示作废信息，附件带大小和类型", () => {
  const detail = buildMaintenanceDetail(maintenanceRow(), { routine: "常规保养" });
  assert.strictEqual(detail.voided, false);
  assert.deepStrictEqual(detail.voidFacts, []);
  assert.deepStrictEqual(labelsOf(detail.facts), ["车辆", "保养类型", "里程", "保养日期", "保养人", "提交时间"]);
  assert.strictEqual(valueOf(detail.facts, "车辆"), "粤B12345");
  assert.strictEqual(valueOf(detail.facts, "提交时间"), "2026-11-01 17:30");
  assert.strictEqual(detail.content, "更换机油、机滤");
  assert.deepStrictEqual(
    detail.attachments.map((item) => [item.file_name, item.extLabel, item.sizeText]),
    [
      ["发票.jpg", "图片", "2.0 KB"],
      ["结算单.pdf", "PDF", ""]
    ]
  );
});

test("保养详情：作废时显示作废时间和原因，没写原因也有交代", () => {
  const detail = buildMaintenanceDetail(
    maintenanceRow({ status: "voided", voided_at: "2026-11-02T01:00:00.000Z", void_reason: "" }),
    {}
  );
  assert.strictEqual(detail.voided, true);
  assert.strictEqual(detail.statusLabel, "已作废");
  assert.deepStrictEqual(
    detail.voidFacts.map((row) => [row.label, row.value]),
    [
      ["作废时间", "2026-11-02 09:00"],
      ["作废原因", "未填写"]
    ]
  );
});

test("保养详情：没填保养人时不留空行", () => {
  const detail = buildMaintenanceDetail(maintenanceRow({ service_provider: "  ", attachments_json: null }), {});
  assert.strictEqual(valueOf(detail.facts, "保养人"), undefined);
  assert.deepStrictEqual(detail.attachments, []);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  if (failed) {
    console.error(`${failed} 个用例失败`);
    process.exit(1);
  }
  console.log(`全部 ${tests.length} 个用例通过`);
})();
