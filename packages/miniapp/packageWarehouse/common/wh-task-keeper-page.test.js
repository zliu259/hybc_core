/** 库房任务详情页上库管的动作。运行：node packageWarehouse/common/wh-task-keeper-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const baseTask = {
  id: 9,
  task_no: "KFR-20261112-001",
  kind: "inspection",
  status: "submitted",
  title: "返库检查",
  blocking: 1,
  required_photo_count: 0,
  photo_count: 0,
  assignee_userid: "wang",
  due_date: null,
  version: 4,
  device_id: 7,
  device_code: "DG-01",
  device_name: "顶管机",
  device_location: "warehouse",
  device_storage_note: null,
  device_project_name: null,
  description: null,
  review_note: null,
  supplement_round: 0,
  result: "fail",
  result_note: "主轴漏油",
  systems_json: null,
  cancel_reason: null,
  photos: []
};

const setup = (task = baseTask, caps = { is_keeper: true }, profile = { username: "lz", roles: ["operator"] }) => {
  const h = createPageHarness({ page: "packageWarehouse/task-detail/index", profile });
  h.respond("GET", "/warehouse/task/9", { success: true, data: task });
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  h.respond("GET", "/wecom/contacts", {
    success: true,
    data: { users: [{ userid: "wang", name: "王师傅" }, { userid: "lz", name: "李震" }, { userid: "zhao", name: "赵工" }] }
  });
  return h;
};

runTests("wh-task-keeper-page", [
  [
    "库管看待执行的任务：有派工选择，当前执行人已选中",
    async () => {
      const h = setup({ ...baseTask, status: "todo", result: null, result_note: null });
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.view.actions.canAssign, true);
      assert.deepStrictEqual(page.data.assignee.range, ["不指定", "李震", "王师傅", "赵工"]);
      assert.strictEqual(page.data.assignee.index, 2);
    }
  ],
  [
    "派工：选了人就提交并刷新",
    async () => {
      const h = setup({ ...baseTask, status: "todo", result: null, result_note: null });
      h.respond("POST", "/warehouse/task/9/assign", { success: true });
      const page = await h.open({ id: "9" });
      await page.onAssignPick(h.event({}, { value: 3 }));
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/assign")[0].data, {
        version: 4,
        assignee_userid: "zhao"
      });
      assert.deepStrictEqual(h.state.toasts, ["已派给 赵工"]);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "派工：选不指定是取消派工；选的还是原来的人就不提交",
    async () => {
      const h = setup({ ...baseTask, status: "todo", result: null, result_note: null });
      h.respond("POST", "/warehouse/task/9/assign", { success: true });
      const page = await h.open({ id: "9" });
      await page.onAssignPick(h.event({}, { value: 2 }));
      assert.deepStrictEqual(h.callsTo("POST", "/assign"), []);
      await page.onAssignPick(h.event({}, { value: 0 }));
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/assign")[0].data, {
        version: 4,
        assignee_userid: null
      });
      assert.deepStrictEqual(h.state.toasts, ["已取消派工"]);
    }
  ],
  [
    "确认完成：不合格的检查提示生成了维修任务",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/confirm", { success: true, data: { followup_task_id: 12 } });
      const page = await h.open({ id: "9" });
      await page.confirmDone();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/confirm")[0].data, { version: 4 });
      assert.deepStrictEqual(h.state.toasts, ["已完成，检查不合格，已生成维修任务"]);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
    }
  ],
  [
    "确认完成：点取消就不提交；没有后续任务时只说已完成",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/confirm", { success: true, data: { followup_task_id: null } });
      const page = await h.open({ id: "9" });
      h.state.modalConfirm = false;
      await page.confirmDone();
      assert.deepStrictEqual(h.callsTo("POST", "/confirm"), []);
      h.state.modalConfirm = true;
      await page.confirmDone();
      assert.deepStrictEqual(h.state.toasts, ["已完成"]);
    }
  ],
  [
    "退回补充：空的不提交，写了要求才提交",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/send-back", { success: true });
      const page = await h.open({ id: "9" });
      h.state.modalInput = "  ";
      await page.sendBack();
      assert.deepStrictEqual(h.state.toasts, ["请写退回要求"]);
      assert.deepStrictEqual(h.callsTo("POST", "/send-back"), []);

      h.state.modalInput = "补一张铭牌照片";
      await page.sendBack();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/send-back")[0].data, {
        version: 4,
        review_note: "补一张铭牌照片"
      });
      assert.strictEqual(h.state.toasts[1], "已退回");
    }
  ],
  [
    "取消任务：阻塞任务先确认，再写原因",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/cancel", { success: true });
      const page = await h.open({ id: "9" });
      h.state.modalInput = "";
      await page.cancelTask();
      assert.deepStrictEqual(h.state.toasts, ["请写取消原因"]);
      assert.deepStrictEqual(h.callsTo("POST", "/cancel"), []);
      assert.ok(h.state.modals[0].content.includes("不再被这个任务卡住"));

      h.state.modalInput = "设备已报废";
      await page.cancelTask();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/cancel")[0].data, {
        version: 4,
        reason: "设备已报废"
      });
      assert.strictEqual(h.state.toasts[1], "任务已取消");
    }
  ],
  [
    "取消任务：不阻塞的任务直接写原因；点取消什么都不做",
    async () => {
      const h = setup({ ...baseTask, blocking: 0 });
      h.respond("POST", "/warehouse/task/9/cancel", { success: true });
      const page = await h.open({ id: "9" });
      h.state.modalConfirm = false;
      await page.cancelTask();
      assert.strictEqual(h.state.modals.length, 1);
      assert.deepStrictEqual(h.state.toasts, []);
      assert.deepStrictEqual(h.callsTo("POST", "/cancel"), []);
    }
  ],
  [
    "动作撞上别人的改动：提示并重新加载，忙碌状态复位",
    async () => {
      const h = setup();
      h.fail("POST", "/warehouse/task/9/confirm", "数据已变化，请刷新后重试", 409);
      const page = await h.open({ id: "9" });
      await page.confirmDone();
      assert.deepStrictEqual(h.state.toasts, ["数据已变化，请刷新后重试"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
    }
  ],
  [
    "动作失败（不是冲突）：提示，留在原地",
    async () => {
      const h = setup();
      h.fail("POST", "/warehouse/task/9/confirm", "网络连接失败");
      const page = await h.open({ id: "9" });
      await page.confirmDone();
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 1);
    }
  ],
  [
    "不是库管：四个动作都没有，也不取通讯录做派工选项",
    async () => {
      const h = setup(baseTask, { is_keeper: false }, { username: "wang", roles: ["operator"] });
      const page = await h.open({ id: "9" });
      const { canAssign, canConfirm, canSendBack, canCancel } = page.data.view.actions;
      assert.deepStrictEqual([canAssign, canConfirm, canSendBack, canCancel], [false, false, false, false]);
      assert.deepStrictEqual(page.data.assignee.range, []);
    }
  ]
]);
