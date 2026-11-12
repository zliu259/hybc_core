/** 发货、返库、转场、入库录单页的流程测试。运行：node packageWarehouse/common/wh-ship-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");
const { toDocPayload } = require("./wh-ship-view");

const DEVICE = { id: 7, device_code: "DG-01", name: "顶管机", category_id: 9, state: "available", state_label: "可用", current_project_id: null };
const ON_SITE = { ...DEVICE, state: "on_project", state_label: "在项目", current_project_id: 3 };
const PIPE = { id: 1, material_code: "M-1", name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", quantity: 100 };

const KIT = { id: 5, kit_no: "PT-20261112-001", project_id: 3, project_name: "一号工程", status: "confirmed", lines: [] };
const FULFILMENT = [
  { id: 1, line_kind: "material", material_id: 1, name_text: "排泥钢管", material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 80, in_stock: 100 },
  { id: 2, line_kind: "device", device_category_id: 9, category_name: "顶管机", spec_text: "DN1200", source: "warehouse", pending: 2, in_stock: 3 }
];
const HOLDINGS = {
  devices: [ON_SITE],
  materials: [{ material_id: 1, material_code: "M-1", name: "排泥钢管", spec: "Φ114", unit: "根", holding: 80 }]
};
const DOC_OK = { success: true, data: { id: 50, doc_no: "KF-20261112-001", replayed: false, created_task_ids: [] } };
const BACK_WAIT = 650;

const setup = () => {
  const h = createPageHarness({ page: "packageWarehouse/ship/index" });
  h.respond("GET", "/warehouse/kit/5", { success: true, data: KIT });
  h.respond("GET", "/warehouse/kit/5/fulfilment", { success: true, data: FULFILMENT });
  h.respond("GET", "/warehouse/project/3/holdings", { success: true, data: HOLDINGS });
  h.respond("GET", "/warehouse/device/7", { success: true, data: DEVICE });
  h.respond("GET", "/device/by-code/DG-01", { success: true, data: DEVICE });
  h.respond("GET", "/warehouse/material?", { success: true, data: [PIPE] });
  return h;
};

const posts = (h) => h.callsTo("POST", "/warehouse/doc");

runTests("wh-ship-page", [
  [
    "按清单发货：物资带出，项目锁定，设备提示还需几台",
    async () => {
      const h = setup();
      const page = await h.open({ type: "out", kitId: "5" });
      assert.strictEqual(h.callsTo("GET", "/warehouse/kit/5").length, 2);
      assert.strictEqual(page.data.title, "发往项目");
      assert.strictEqual(page.data.kitLocked, true);
      assert.strictEqual(page.data.kitNo, "PT-20261112-001");
      assert.strictEqual(page.data.projectId, 3);
      assert.deepStrictEqual(
        page.data.materials.map((row) => [row.label, row.quantity, row.availableText]),
        [["排泥钢管 Φ114", "80", "在库 100"]]
      );
      assert.deepStrictEqual(page.data.hints, ["顶管机（DN1200）：还需 2 台，库里可用 3 台"]);
      assert.deepStrictEqual(h.state.titles, ["发往项目"]);
    }
  ],
  [
    "连续扫码：重复的、不是设备码的各提示一次后接着扫，取消才停",
    async () => {
      const h = setup();
      const page = await h.open({ type: "out", kitId: "5" });
      h.state.scans = ["HYBC:D:DG-01", "HYBC:D:DG-01", "hello"];
      await page.onScanAdd();
      assert.deepStrictEqual(page.data.devices.map((item) => item.code), ["DG-01"]);
      assert.deepStrictEqual(h.state.toasts, ["已加 DG-01", "DG-01 已经加过了", "不是设备码"]);
      assert.strictEqual(page.data.scanning, false);
      assert.deepStrictEqual(page.data.hints, ["顶管机（DN1200）：还需 1 台（已选 1 台）"]);
      assert.ok(h.state.vibrations >= 1);
    }
  ],
  [
    "扫码时断网：提示并停下，按钮恢复",
    async () => {
      const h = setup();
      h.fail("GET", "/device/by-code/DG-09", "网络连接失败");
      const page = await h.open({ type: "out" });
      h.state.scans = ["HYBC:D:DG-09", "HYBC:D:DG-01"];
      await page.onScanAdd();
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.deepStrictEqual(page.data.devices, []);
      assert.strictEqual(page.data.scanning, false);
      assert.strictEqual(h.state.scans.length, 1);
    }
  ],
  [
    "提交成功：请求体对，提示单号，返回上一页",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", DOC_OK);
      const page = await h.open({ type: "out", kitId: "5" });
      h.state.scans = ["HYBC:D:DG-01"];
      await page.onScanAdd();
      page.onQtyInput(h.event({ id: 1, field: "quantity" }, { value: "60" }));
      page.onField(h.event({ field: "handoverName" }, { value: "老王" }));
      const expected = toDocPayload(page.form);
      await page.submit();
      assert.deepStrictEqual(posts(h)[0].data, expected);
      assert.strictEqual(posts(h)[0].data.project_kit_id, 5);
      assert.deepStrictEqual(posts(h)[0].data.material_lines, [{ material_id: 1, quantity: 60 }]);
      assert.deepStrictEqual(posts(h)[0].data.device_lines, [{ device_id: 7 }]);
      assert.strictEqual(h.state.toasts[h.state.toasts.length - 1], "已提交 KF-20261112-001");
      assert.strictEqual(page.data.busy, false);
      await h.flush(BACK_WAIT);
      assert.strictEqual(h.state.backs, 1);
    }
  ],
  [
    "连点两次提交只发一次；提交成功后再点也不发",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", DOC_OK);
      const page = await h.open({ type: "out", kitId: "5" });
      await Promise.all([page.submit(), page.submit()]);
      assert.strictEqual(posts(h).length, 1);
      await page.submit();
      assert.strictEqual(posts(h).length, 1);
      await h.flush(BACK_WAIT);
      assert.strictEqual(h.state.backs, 1);
    }
  ],
  [
    "提交失败后重试：同一个请求号，重放的也算成功",
    async () => {
      const h = setup();
      h.failOnce("POST", "/warehouse/doc", "网络连接失败");
      h.respond("POST", "/warehouse/doc", { success: true, data: { ...DOC_OK.data, replayed: true } });
      const page = await h.open({ type: "out", kitId: "5" });
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(page.data.materials.length, 1);
      assert.strictEqual(h.state.backs, 0);

      await page.submit();
      assert.strictEqual(posts(h).length, 2);
      assert.strictEqual(posts(h)[0].data.client_request_id, posts(h)[1].data.client_request_id);
      assert.strictEqual(h.state.toasts[1], "已提交 KF-20261112-001");
      await h.flush(BACK_WAIT);
      assert.strictEqual(h.state.backs, 1);
    }
  ],
  [
    "库存不足：原样提示后端的话，留在页面",
    async () => {
      const h = setup();
      h.fail("POST", "/warehouse/doc", "库存不足：排泥钢管 Φ114，在库 10");
      const page = await h.open({ type: "out", kitId: "5" });
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["库存不足：排泥钢管 Φ114，在库 10"]);
      assert.strictEqual(page.data.busy, false);
      await h.flush(BACK_WAIT);
      assert.strictEqual(h.state.backs, 0);
    }
  ],
  [
    "没填完整时提交：提示问题，不发请求",
    async () => {
      const h = setup();
      const page = await h.open({ type: "out" });
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["请选择项目"]);
      assert.deepStrictEqual(posts(h), []);
    }
  ],
  [
    "项目返库：选项目带出在场清单，改报损，提交后提示生成了检查任务",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", { success: true, data: { id: 51, doc_no: "KF-2", replayed: false, created_task_ids: [11, 12] } });
      const page = await h.open({ type: "back" });
      assert.strictEqual(page.data.materials.length, 0);
      await page.onProjectChange(h.event({}, { projectId: 3, projectName: "一号工程" }));
      assert.strictEqual(h.callsTo("GET", "/warehouse/project/3/holdings").length, 1);
      assert.deepStrictEqual(page.data.devices.map((item) => item.code), ["DG-01"]);
      assert.deepStrictEqual(
        page.data.materials.map((row) => [row.returned, row.lost, row.availableText, row.showLost]),
        [["80", "0", "在场 80", true]]
      );
      page.onQtyInput(h.event({ id: 1, field: "returned" }, { value: "70" }));
      page.onQtyInput(h.event({ id: 1, field: "lost" }, { value: "10" }));
      page.onDeviceField(h.event({ id: 7, field: "usageMeters" }, { value: "120.5" }));
      await page.submit();
      assert.deepStrictEqual(posts(h)[0].data.material_lines, [
        { material_id: 1, quantity: 70, outcome: "returned" },
        { material_id: 1, quantity: 10, outcome: "lost" }
      ]);
      assert.deepStrictEqual(posts(h)[0].data.device_lines, [{ device_id: 7, usage_meters: 120.5 }]);
      assert.strictEqual(h.state.toasts[h.state.toasts.length - 1], "已提交 KF-2，已生成 2 个检查任务");
    }
  ],
  [
    "返库：带项目参数直接带出；换项目时清空重新带",
    async () => {
      const h = setup();
      h.respond("GET", "/warehouse/project/4/holdings", { success: true, data: { devices: [], materials: [] } });
      const page = await h.open({ type: "back", projectId: "3" });
      assert.strictEqual(page.data.projectId, 3);
      assert.strictEqual(page.data.devices.length, 1);
      await page.onProjectChange(h.event({}, { projectId: 4, projectName: "二号工程" }));
      assert.deepStrictEqual(page.data.devices, []);
      assert.deepStrictEqual(page.data.materials, []);
    }
  ],
  [
    "在场清单取不到：提示，项目还是选上了，可以手动加",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/project/3/holdings", "服务器出错，请稍后重试", 500);
      const page = await h.open({ type: "back", projectId: "3" });
      assert.deepStrictEqual(h.state.toasts, ["服务器出错，请稍后重试"]);
      assert.strictEqual(page.data.projectId, 3);
      assert.strictEqual(page.data.prefilling, false);
    }
  ],
  [
    "从设备页进来发货：设备已在单里",
    async () => {
      const h = setup();
      const page = await h.open({ type: "out", deviceId: "7" });
      assert.deepStrictEqual(page.data.devices.map((item) => item.code), ["DG-01"]);
    }
  ],
  [
    "搜设备加进来；删掉一台",
    async () => {
      const h = setup();
      h.respond("GET", "/warehouse/device?", { success: true, data: [DEVICE, { ...DEVICE, id: 8, device_code: "DG-02", state: "repairing", state_label: "维修中" }] });
      const page = await h.open({ type: "out" });
      await page.onDeviceSearch(h.event({}, { keyword: "DG" }));
      assert.deepStrictEqual(page.data.deviceOptions.range, ["搜索设备", "DG-01 顶管机 · 可用", "DG-02 顶管机 · 维修中"]);
      page.onDevicePick(h.event({}, { value: 2 }));
      assert.deepStrictEqual(h.state.toasts, ["DG-02 现在是维修中，不能发出"]);
      page.onDevicePick(h.event({}, { value: 1 }));
      assert.deepStrictEqual(page.data.devices.map((item) => item.code), ["DG-01"]);
      page.removeDeviceTap(h.event({ id: 7 }));
      assert.deepStrictEqual(page.data.devices, []);
    }
  ],
  [
    "加清单外的物资；重复的有提示；删掉一行",
    async () => {
      const h = setup();
      const page = await h.open({ type: "out" });
      await page.onMaterialSearch(h.event({}, { keyword: "钢管" }));
      assert.ok(h.callsTo("GET", "/warehouse/material?")[0].path.includes("status=active"));
      assert.deepStrictEqual(page.data.materialOptions.range, ["搜索物资", "排泥钢管 Φ114 · 在库 100 根"]);
      page.onMaterialPick(h.event({}, { value: 1 }));
      page.onMaterialPick(h.event({}, { value: 1 }));
      assert.strictEqual(page.data.materials.length, 1);
      assert.deepStrictEqual(h.state.toasts, ["排泥钢管 Φ114 已经在单里"]);
      page.removeMaterialTap(h.event({ id: 1 }));
      assert.deepStrictEqual(page.data.materials, []);
    }
  ],
  [
    "入库：没有项目和设备，拍送货单，带供应商",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", DOC_OK);
      const page = await h.open({ type: "in" });
      assert.strictEqual(page.data.needsProject, false);
      assert.strictEqual(page.data.canAddDevice, false);
      await page.onMaterialSearch(h.event({}, { keyword: "" }));
      page.onMaterialPick(h.event({}, { value: 1 }));
      page.onQtyInput(h.event({ id: 1, field: "quantity" }, { value: "200" }));
      page.onField(h.event({ field: "counterparty" }, { value: "宏图建材" }));
      h.state.images = [["/tmp/a.jpg", "/tmp/b.jpg"]];
      await page.choosePhotos();
      assert.deepStrictEqual(h.state.uploads, ["wh-doc/a.jpg", "wh-doc/b.jpg"]);
      assert.strictEqual(page.data.photos.length, 2);
      page.removePhoto(h.event({ index: 0 }));
      assert.strictEqual(page.data.photos.length, 1);
      await page.submit();
      assert.deepStrictEqual(posts(h)[0].data, {
        doc_type: "inbound",
        client_request_id: posts(h)[0].data.client_request_id,
        counterparty: "宏图建材",
        photo_keys: ["wh-doc/b.jpg"],
        device_lines: [],
        material_lines: [{ material_id: 1, quantity: 200 }]
      });
    }
  ],
  [
    "转场：选来源带出在场，选目的，提交",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/doc", DOC_OK);
      const page = await h.open({ type: "transfer", projectId: "3" });
      assert.strictEqual(page.data.needsToProject, true);
      assert.strictEqual(page.data.canAddMaterial, false);
      assert.deepStrictEqual(page.data.materials.map((row) => [row.quantity, row.showLost]), [["80", false]]);
      page.onToProjectChange(h.event({}, { projectId: 4, projectName: "二号工程" }));
      await page.submit();
      assert.strictEqual(posts(h)[0].data.project_id, 3);
      assert.strictEqual(posts(h)[0].data.to_project_id, 4);
      assert.strictEqual(posts(h)[0].data.doc_type, "transfer");
    }
  ],
  [
    "类型参数不认识时按发货；清单取不到时提示",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/ship/index" });
      h.fail("GET", "/warehouse/kit/5", "清单不存在", 404);
      const page = await h.open({ type: "weird", kitId: "5" });
      assert.strictEqual(page.data.type, "out");
      assert.deepStrictEqual(h.state.toasts, ["清单不存在"]);
      assert.strictEqual(page.data.kitLocked, false);
      assert.strictEqual(page.data.prefilling, false);
    }
  ]
]);
