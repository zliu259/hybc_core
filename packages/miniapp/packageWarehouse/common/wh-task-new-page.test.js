/** 新建库房任务页的流程测试。运行：node packageWarehouse/common/wh-task-new-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const DEVICE = { id: 7, device_code: "DG-01", name: "顶管机", state_label: "可用" };

const setup = () => {
  const h = createPageHarness({ page: "packageWarehouse/task-new/index" });
  h.respond("GET", "/wecom/contacts", {
    success: true,
    data: { users: [{ userid: "wang", name: "王师傅" }, { userid: "lz", name: "李震" }] }
  });
  h.respond("GET", "/warehouse/device/7", { success: true, data: DEVICE });
  h.respond("GET", "/warehouse/device?", { success: true, data: [DEVICE, { id: 8, device_code: "DG-02", name: "泥水泵", state_label: "可用" }] });
  return h;
};

runTests("wh-task-new-page", [
  [
    "带设备参数：设备预填并锁定",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      assert.strictEqual(h.callsTo("GET", "/warehouse/device/7").length, 1);
      assert.strictEqual(page.data.form.deviceId, 7);
      assert.strictEqual(page.data.form.deviceText, "DG-01 顶管机");
      assert.strictEqual(page.data.deviceLocked, true);
      assert.deepStrictEqual(page.data.assignee.range, ["不指定", "李震", "王师傅"]);
    }
  ],
  [
    "不带参数：设备可搜可选可清",
    async () => {
      const h = setup();
      const page = await h.open({});
      assert.strictEqual(page.data.deviceLocked, false);
      assert.strictEqual(page.data.form.deviceId, null);
      await page.onDeviceSearch(h.event({}, { keyword: "DG" }));
      assert.ok(h.callsTo("GET", "/warehouse/device?").some((call) => call.path.includes("keyword=DG")));
      assert.deepStrictEqual(page.data.deviceOptions.range, ["不关联设备", "DG-01 顶管机", "DG-02 泥水泵"]);
      page.onDevicePick(h.event({}, { value: 2 }));
      assert.strictEqual(page.data.form.deviceId, 8);
      assert.strictEqual(page.data.form.deviceText, "DG-02 泥水泵");
      page.onDevicePick(h.event({}, { value: 0 }));
      assert.strictEqual(page.data.form.deviceId, null);
      assert.strictEqual(page.data.form.deviceText, "");
    }
  ],
  [
    "扫码选设备；扫到的不是设备码有提示",
    async () => {
      const h = setup();
      h.respond("GET", "/device/by-code/DG-01", { success: true, data: DEVICE });
      const page = await h.open({});
      h.state.scans = ["HYBC:D:DG-01", "hello"];
      await page.onScanDevice();
      assert.strictEqual(page.data.form.deviceId, 7);
      await page.onScanDevice();
      assert.deepStrictEqual(h.state.toasts, ["不是设备码"]);
      assert.strictEqual(page.data.form.deviceId, 7);
    }
  ],
  [
    "标题为空不提交",
    async () => {
      const h = setup();
      const page = await h.open({});
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["请填写任务标题"]);
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task"), []);
    }
  ],
  [
    "填好提交：请求体正确，成功后进新任务的详情",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task", { success: true, data: { id: 31, task_no: "KFR-20261112-009" } });
      const page = await h.open({ deviceId: "7" });
      page.onKind(h.event({}, { value: 1 }));
      page.onInput(h.event({ field: "title" }, { value: " 保养 " }));
      page.onInput(h.event({ field: "description" }, { value: "换液压油" }));
      page.onInput(h.event({ field: "requiredPhotoCount" }, { value: "2" }));
      page.onAssigneePick(h.event({}, { value: 2 }));
      page.onDueDate(h.event({}, { value: "2026-11-20" }));
      await page.submit();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task")[0].data, {
        kind: "servicing",
        title: "保养",
        description: "换液压油",
        device_id: 7,
        assignee_userid: "wang",
        due_date: "2026-11-20",
        required_photo_count: 2
      });
      assert.deepStrictEqual(h.state.redirects, ["/packageWarehouse/task-detail/index?id=31"]);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "提交失败：提示，忙碌状态复位，表单内容还在",
    async () => {
      const h = setup();
      h.fail("POST", "/warehouse/task", "设备不存在");
      const page = await h.open({});
      page.onInput(h.event({ field: "title" }, { value: "换油" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["设备不存在"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(page.data.form.title, "换油");
      assert.deepStrictEqual(h.state.redirects, []);
    }
  ],
  [
    "连点两次只建一个任务；期限可以清掉",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task", { success: true, data: { id: 31, task_no: "KFR-1" } });
      const page = await h.open({});
      page.onInput(h.event({ field: "title" }, { value: "换油" }));
      page.onDueDate(h.event({}, { value: "2026-11-20" }));
      page.clearDueDate();
      assert.strictEqual(page.data.form.dueDate, "");
      await Promise.all([page.submit(), page.submit()]);
      assert.strictEqual(h.callsTo("POST", "/warehouse/task").length, 1);
    }
  ]
]);
