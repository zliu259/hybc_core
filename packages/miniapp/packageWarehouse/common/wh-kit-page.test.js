/** 配套清单详情页的流程测试。运行：node packageWarehouse/common/wh-kit-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const line = (id, overrides = {}) => ({
  id,
  kit_id: 5,
  section: "顶进设备",
  sort_order: id,
  line_kind: "material",
  device_category_id: null,
  material_id: 3,
  name_text: "排泥钢管",
  spec_text: null,
  unit: "根",
  planned_qty: 120,
  source: "warehouse",
  note: null,
  material_name: "排泥钢管",
  material_spec: "Φ114",
  material_unit: "根",
  material_kind: "turnover",
  category_name: null,
  spec_choices: [{ id: 3, spec: "Φ114" }, { id: 4, spec: "Φ80" }],
  ...overrides
});

const LINES = [
  line(1, { line_kind: "device", device_category_id: 9, material_id: null, name_text: "顶管机", planned_qty: 1, unit: "台", category_name: "顶管机", spec_choices: [], material_name: null, material_spec: null }),
  line(2),
  line(3, {
    section: "注浆设备",
    material_id: null,
    name_text: "注浆管",
    planned_qty: 30,
    unit: null,
    material_name: null,
    material_spec: null,
    material_unit: null,
    spec_choices: [{ id: 7, spec: "DN25" }, { id: 8, spec: "DN32" }]
  })
];

const kitOf = (overrides = {}) => ({
  id: 5,
  kit_no: "PT-20261112-001",
  title: "主清单",
  status: "draft",
  project_id: 3,
  project_name: "一号工程",
  project_manager_userid: "zhang",
  template_name: "泥水平衡",
  copied_from_kit_id: null,
  line_count: 3,
  remark: null,
  created_by_userid: "zhang",
  submitted_by_userid: null,
  submitted_at: null,
  confirmed_by_userid: null,
  confirmed_at: null,
  close_reason: null,
  version: 3,
  lines: LINES,
  ...overrides
});

const LEAD = { profile: { username: "zhang", roles: ["site_manager"] }, caps: { is_keeper: false, can_create_kit: true } };
const KEEPER = { profile: { username: "lz", roles: ["operator"] }, caps: { is_keeper: true, can_create_kit: true } };

/** 清单放在 h.current 里；PUT 成功后版本加一，像真的后端一样。 */
const setup = (kit, who = LEAD) => {
  const h = createPageHarness({ page: "packageWarehouse/kit/index", profile: who.profile });
  h.current = kit;
  h.respond("GET", "/warehouse/kit/5", () => ({ success: true, data: h.current }));
  h.respond("GET", "/warehouse/me", { success: true, data: who.caps });
  h.respond("PUT", "/warehouse/kit/5", () => {
    h.current = { ...h.current, version: h.current.version + 1 };
    return { success: true };
  });
  return h;
};

const rowAt = (page, g, r) => page.data.groups[g].rows[r];
const sequence = (h) =>
  h.state.calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path.replace("/api/v1/warehouse", "")}`);

runTests("wh-kit-page", [
  [
    "打开草稿：头部、按钮、分节全部收起",
    async () => {
      const h = setup(kitOf());
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.header.kitNo, "PT-20261112-001");
      assert.strictEqual(page.data.header.sourceText, "模板：泥水平衡");
      assert.strictEqual(page.data.actions.canEdit, true);
      assert.strictEqual(page.data.actions.canSubmit, true);
      assert.strictEqual(page.data.actions.canConfirm, false);
      assert.deepStrictEqual(page.data.groups.map((group) => [group.section, group.count, group.open]), [
        ["顶进设备", 2, false],
        ["注浆设备", 1, false]
      ]);
      assert.strictEqual(page.data.dirty, false);
      assert.strictEqual(h.callsTo("GET", "/fulfilment").length, 0);
      assert.deepStrictEqual(h.state.titles, ["PT-20261112-001"]);
    }
  ],
  [
    "点分节标题展开和收起",
    async () => {
      const h = setup(kitOf());
      const page = await h.open({ id: "5" });
      page.toggleSection(h.event({ g: 1 }));
      assert.deepStrictEqual(page.data.groups.map((group) => group.open), [false, true]);
      page.toggleSection(h.event({ g: 1 }));
      assert.deepStrictEqual(page.data.groups.map((group) => group.open), [false, false]);
    }
  ],
  [
    "改一行数量后保存：只有那一行变了，保存后重新加载",
    async () => {
      const h = setup(kitOf());
      const page = await h.open({ id: "5" });
      page.onQtyInput(h.event({ g: 0, r: 1 }, { value: "150" }));
      assert.strictEqual(page.data.dirty, true);
      await page.save();
      const [put] = h.callsTo("PUT", "/warehouse/kit/5");
      assert.strictEqual(put.data.version, 3);
      assert.strictEqual(put.data.title, "主清单");
      assert.strictEqual(put.data.remark, null);
      assert.deepStrictEqual(put.data.lines.map((item) => item.planned_qty), [1, 150, 30]);
      assert.deepStrictEqual(put.data.lines.map((item) => item.material_id), [null, 3, null]);
      assert.deepStrictEqual(h.state.toasts, ["已保存"]);
      assert.strictEqual(h.callsTo("GET", "/warehouse/kit/5").length, 2);
      assert.strictEqual(page.data.dirty, false);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "有物资行没选规格时提交：提示几行，不发请求，那个分节展开并标出",
    async () => {
      const h = setup(kitOf());
      const page = await h.open({ id: "5" });
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["有 1 行要先处理"]);
      assert.deepStrictEqual(sequence(h), []);
      assert.deepStrictEqual(page.data.groups.map((group) => [group.open, group.problemCount]), [
        [false, 0],
        [true, 1]
      ]);
      assert.strictEqual(rowAt(page, 1, 0).problem, "注浆管 还没选规格");
    }
  ],
  [
    "选了规格再提交：先保存再提交，提交用的是保存后的版本号",
    async () => {
      const h = setup(kitOf());
      h.respond("POST", "/warehouse/kit/5/submit", { success: true, data: { status: "submitted" } });
      const page = await h.open({ id: "5" });
      page.onSpecPick(h.event({ g: 1, r: 0 }, { value: 1 }));
      assert.strictEqual(rowAt(page, 1, 0).materialId, 8);
      assert.strictEqual(rowAt(page, 1, 0).needsSpec, false);
      assert.strictEqual(rowAt(page, 1, 0).detailText, "DN32");
      await page.submit();
      assert.deepStrictEqual(sequence(h), ["PUT /kit/5", "POST /kit/5/submit"]);
      assert.strictEqual(h.callsTo("PUT", "/warehouse/kit/5")[0].data.lines[2].material_id, 8);
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit/5/submit")[0].data, { version: 4 });
      assert.strictEqual(h.state.toasts[h.state.toasts.length - 1], "已提交，等库管确认");
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "保存时别人先改了：提示并重新加载，不再提交，忙碌状态复位",
    async () => {
      const h = setup(kitOf({ lines: [LINES[0], LINES[1]] }));
      h.fail("PUT", "/warehouse/kit/5", "数据已变化，请刷新后重试", 409);
      const page = await h.open({ id: "5" });
      page.onQtyInput(h.event({ g: 0, r: 1 }, { value: "150" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["数据已变化，请刷新后重试"]);
      assert.deepStrictEqual(sequence(h), ["PUT /kit/5"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/kit/5").length, 2);
      // 重新加载后是服务器上的数量，自己没保存上的改动不留着
      assert.strictEqual(rowAt(page, 0, 1).qty, "120");
      assert.strictEqual(page.data.dirty, false);
    }
  ],
  [
    "改来源",
    async () => {
      const h = setup(kitOf());
      const page = await h.open({ id: "5" });
      page.onSourcePick(h.event({ g: 0, r: 1 }, { value: 2 }));
      assert.strictEqual(rowAt(page, 0, 1).source, "rental");
      assert.strictEqual(rowAt(page, 0, 1).sourceLabel, "租赁");
      await page.save();
      assert.strictEqual(h.callsTo("PUT", "/warehouse/kit/5")[0].data.lines[1].source, "rental");
    }
  ],
  [
    "库管在待确认的清单上改了数量再确认：先保存再确认",
    async () => {
      const h = setup(kitOf({ status: "submitted", submitted_by_userid: "zhang", lines: [LINES[0], LINES[1]] }), KEEPER);
      h.respond("POST", "/warehouse/kit/5/confirm", { success: true });
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.actions.canConfirm, true);
      page.onQtyInput(h.event({ g: 0, r: 1 }, { value: "100" }));
      await page.confirmKit();
      assert.deepStrictEqual(sequence(h), ["PUT /kit/5", "POST /kit/5/confirm"]);
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit/5/confirm")[0].data, { version: 4 });
      assert.strictEqual(h.state.toasts[h.state.toasts.length - 1], "清单已确认");
    }
  ],
  [
    "库管提交自己的清单是直接确认",
    async () => {
      const h = setup(kitOf({ lines: [LINES[0], LINES[1]] }), KEEPER);
      h.respond("POST", "/warehouse/kit/5/submit", { success: true, data: { status: "confirmed" } });
      const page = await h.open({ id: "5" });
      await page.submit();
      assert.strictEqual(h.state.toasts[h.state.toasts.length - 1], "已提交并确认");
    }
  ],
  [
    "已确认的清单：带执行情况，库管能按清单发货、看项目在场",
    async () => {
      const h = setup(
        kitOf({ status: "confirmed", confirmed_by_userid: "lz", confirmed_at: "2026-11-12T03:00:00.000Z", lines: [LINES[0], LINES[1]] }),
        KEEPER
      );
      h.respond("GET", "/warehouse/kit/5/fulfilment", {
        success: true,
        data: [
          { id: 1, shipped: 1, pending: 0, in_stock: 2 },
          { id: 2, shipped: 40, pending: 80, in_stock: 100 }
        ]
      });
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.showFulfilment, true);
      assert.strictEqual(rowAt(page, 0, 1).pendingText, "80");
      assert.strictEqual(rowAt(page, 0, 0).done, true);
      assert.strictEqual(page.data.actions.canEdit, false);
      assert.strictEqual(page.data.actions.canShip, true);
      page.goShip();
      page.goProject();
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/ship/index?type=out&kitId=5",
        "/packageWarehouse/project/index?projectId=3"
      ]);
    }
  ],
  [
    "关闭清单：项目没结清时原样提示后端的话",
    async () => {
      const h = setup(kitOf({ status: "confirmed", confirmed_at: "2026-11-12T03:00:00.000Z", lines: [LINES[0]] }), KEEPER);
      h.respond("GET", "/warehouse/kit/5/fulfilment", { success: true, data: [] });
      h.fail("POST", "/warehouse/kit/5/close", "项目还有 1 台设备、2 种周转件在场，结清后才能关闭", 409);
      const page = await h.open({ id: "5" });
      h.state.modalConfirm = false;
      await page.closeKit();
      assert.deepStrictEqual(sequence(h), []);
      h.state.modalConfirm = true;
      await page.closeKit();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit/5/close")[0].data, { version: 3 });
      assert.deepStrictEqual(h.state.toasts, ["项目还有 1 台设备、2 种周转件在场，结清后才能关闭"]);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "作废：原因为空不提交；填了才提交",
    async () => {
      const h = setup(kitOf());
      h.respond("POST", "/warehouse/kit/5/discard", { success: true });
      const page = await h.open({ id: "5" });
      h.state.modalInput = "";
      await page.discardKit();
      assert.deepStrictEqual(h.state.toasts, ["请写作废原因"]);
      assert.deepStrictEqual(sequence(h), []);
      h.state.modalInput = "建错项目了";
      await page.discardKit();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/kit/5/discard")[0].data, { version: 3, reason: "建错项目了" });
      assert.strictEqual(h.state.toasts[1], "清单已作废");
    }
  ],
  [
    "别的项目的现场负责人、操作员：只能看",
    async () => {
      const h = setup(kitOf({ project_manager_userid: "someone-else" }));
      const page = await h.open({ id: "5" });
      assert.strictEqual(Object.values(page.data.actions).some(Boolean), false);
    }
  ],
  [
    "清单不存在",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/kit/index" });
      h.fail("GET", "/warehouse/kit/5", "清单不存在", 404);
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.notFound, true);
      assert.deepStrictEqual(h.state.toasts, ["清单不存在"]);
      assert.strictEqual(page.data.loading, false);
    }
  ]
]);
