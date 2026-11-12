/** 库房任务详情页（执行人这一侧）的流程测试。运行：node packageWarehouse/common/wh-task-detail-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const baseTask = {
  id: 9,
  task_no: "KFR-20261112-001",
  kind: "inspection",
  status: "todo",
  title: "返库检查",
  blocking: 1,
  required_photo_count: 3,
  photo_count: 1,
  assignee_userid: "wang",
  due_date: "2026-11-14",
  version: 2,
  device_id: 7,
  device_code: "DG-01",
  device_name: "顶管机",
  device_location: "warehouse",
  device_storage_note: null,
  device_project_name: null,
  description: "按返库检查表查",
  review_note: null,
  supplement_round: 0,
  result: null,
  result_note: null,
  systems_json: null,
  cancel_reason: null,
  photos: [{ id: 5, task_id: 9, file_key: "wh-task/a.jpg", uploaded_by_userid: "wang" }]
};

const setup = (task = baseTask, profile = { username: "wang", roles: ["operator"] }, caps = { is_keeper: false }) => {
  const h = createPageHarness({ page: "packageWarehouse/task-detail/index", profile });
  h.current = { ...task };
  h.respond("GET", "/warehouse/task/9", () => ({ success: true, data: h.current }));
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  return h;
};

runTests("wh-task-detail-page", [
  [
    "打开任务：详情、照片缩略图、能不能删",
    async () => {
      const h = setup({
        ...baseTask,
        photo_count: 2,
        photos: [
          { id: 5, task_id: 9, file_key: "wh-task/a.jpg", uploaded_by_userid: "wang" },
          { id: 6, task_id: 9, file_key: "wh-task/b.jpg", uploaded_by_userid: "lz" }
        ]
      });
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.view.header.title, "返库检查");
      assert.strictEqual(page.data.view.actions.canWork, true);
      assert.deepStrictEqual(page.data.photos, [
        { id: 5, url: "signed:wh-task/a.jpg", canDelete: true },
        { id: 6, url: "signed:wh-task/b.jpg", canDelete: false }
      ]);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "有设备的任务：带出适用资料（按这个活排过序），最多 5 条，能点开、能看全部",
    async () => {
      const h = setup();
      const docs = Array.from({ length: 7 }, (_, index) => ({
        id: index + 1,
        title: `资料 ${index + 1}`,
        doc_category: index === 0 ? "maintenance" : "manual",
        file_size: 1024,
        scope: "device",
        device_code: "DG-01",
        device_name: "顶管机",
        validity: index === 1 ? "expired" : "none"
      }));
      h.respond("GET", "/doc-library/for-device/7", { success: true, data: docs });
      const page = await h.open({ id: "9" });
      assert.deepStrictEqual(h.callsTo("GET", "/doc-library/").map((call) => call.path), [
        "/api/v1/doc-library/for-device/7?task_kind=inspection"
      ]);
      assert.strictEqual(page.data.docs.total, 7);
      assert.strictEqual(page.data.docs.more, true);
      assert.deepStrictEqual(
        page.data.docs.rows.map((row) => row.id),
        [1, 2, 3, 4, 5]
      );
      assert.strictEqual(page.data.docs.rows[0].categoryLabel, "保养维修");
      assert.strictEqual(page.data.docs.rows[1].expired, true);
      page.openDoc(h.event({ id: 2 }));
      page.goDocs();
      assert.deepStrictEqual(h.state.navigations, [
        "/packageWarehouse/doc-view/index?id=2",
        "/packageWarehouse/docs/index?deviceId=7&code=DG-01"
      ]);
    }
  ],
  [
    "这台设备没有资料：不显示这一段",
    async () => {
      const h = setup();
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.docs, null);
    }
  ],
  [
    "任务没有设备：不请求资料",
    async () => {
      const h = setup({ ...baseTask, device_id: null, device_code: null, device_name: null });
      const page = await h.open({ id: "9" });
      assert.strictEqual(h.callsTo("GET", "/doc-library/").length, 0);
      assert.strictEqual(page.data.docs, null);
      assert.strictEqual(page.data.view.header.title, "返库检查");
    }
  ],
  [
    "资料取不到不影响任务：任务照常显示，不弹提示",
    async () => {
      const h = setup();
      h.fail("GET", "/doc-library/for-device/7", "服务器出错，请稍后重试", 500);
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.view.actions.canWork, true);
      assert.strictEqual(page.data.docs, null);
      assert.deepStrictEqual(h.state.toasts, []);
    }
  ],
  [
    "从卡片冷启动：登录是在第一次请求里完成的，执行人第一次打开就要能提交",
    async () => {
      const h = setup(baseTask, null);
      h.state.profile = null;
      h.respond("GET", "/warehouse/me", () => {
        // request 发现没有登录态会先登录，登录完本地才有用户信息
        h.state.profile = { username: "wang", roles: ["operator"] };
        return { success: true, data: { is_keeper: false } };
      });
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.view.actions.canWork, true);
      assert.strictEqual(page.data.photos[0].canDelete, true);
    }
  ],
  [
    "加载失败（不是不存在）：页面上写着加载失败，下拉后恢复",
    async () => {
      const h = setup();
      h.failOnce("GET", "/warehouse/task/9", "网络连接失败");
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.loadFailed, true);
      assert.strictEqual(page.data.notFound, false);
      assert.strictEqual(page.data.view, null);
      await page.onPullDownRefresh();
      assert.strictEqual(page.data.loadFailed, false);
      assert.strictEqual(page.data.view.header.title, "返库检查");
    }
  ],
  [
    "选图回来时页面正在刷新：传完照片后要再取一次，不能停在旧的张数上",
    async () => {
      const h = setup({ ...baseTask, required_photo_count: 1, photo_count: 0, photos: [] });
      h.respond("GET", "/warehouse/task/9", async () => {
        const snapshot = { ...h.current };
        await new Promise((resolve) => setTimeout(resolve, 60));
        return { success: true, data: snapshot };
      });
      h.respond("POST", "/warehouse/task/9/photo", () => {
        h.current = {
          ...h.current,
          photo_count: 1,
          photos: [{ id: 5, task_id: 9, file_key: "wh-task/1.jpg", uploaded_by_userid: "wang" }]
        };
        return { success: true, data: { id: 5 } };
      });
      const page = await h.open({ id: "9" });
      h.state.images = [["/tmp/1.jpg"]];
      // 企微在选图界面关掉时会触发 onShow，它的刷新和上传同时在跑
      await Promise.all([page.onShow(), page.choosePhotos()]);
      await h.flush(200);
      assert.strictEqual(page.data.view.photo.count, 1);
      assert.strictEqual(page.data.view.photo.missing, 0);
      assert.strictEqual(page.data.photos.length, 1);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "任务不存在",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/task-detail/index" });
      h.fail("GET", "/warehouse/task/9", "任务不存在", 404);
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.notFound, true);
      assert.deepStrictEqual(h.state.toasts, ["任务不存在"]);
    }
  ],
  [
    "一次选 3 张：逐张上传并登记，然后重新加载",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/photo", { success: true, data: { id: 10 } });
      const page = await h.open({ id: "9" });
      h.state.images = [["/tmp/1.jpg", "/tmp/2.jpg", "/tmp/3.jpg"]];
      await page.choosePhotos();
      assert.deepStrictEqual(h.state.uploads, ["wh-task/1.jpg", "wh-task/2.jpg", "wh-task/3.jpg"]);
      assert.deepStrictEqual(
        h.callsTo("POST", "/warehouse/task/9/photo").map((call) => call.data),
        [{ file_key: "wh-task/1.jpg" }, { file_key: "wh-task/2.jpg" }, { file_key: "wh-task/3.jpg" }]
      );
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
      assert.strictEqual(page.data.uploading, false);
      assert.deepStrictEqual(h.state.toasts, ["已上传 3 张"]);
    }
  ],
  [
    "第 2 张上传失败：提示第几张，已传的保留，后面的不再传",
    async () => {
      const h = setup();
      h.respond("POST", "/warehouse/task/9/photo", { success: true, data: { id: 10 } });
      const page = await h.open({ id: "9" });
      h.state.images = [["/tmp/1.jpg", "/tmp/2.jpg", "/tmp/3.jpg"]];
      h.state.uploadFailures = ["/tmp/2.jpg"];
      await page.choosePhotos();
      assert.deepStrictEqual(h.state.uploads, ["wh-task/1.jpg"]);
      assert.strictEqual(h.callsTo("POST", "/warehouse/task/9/photo").length, 1);
      assert.deepStrictEqual(h.state.toasts, ["第 2 张上传失败"]);
      assert.strictEqual(page.data.uploading, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
    }
  ],
  [
    "登记照片时后端拒绝（超过上限）：提示后端的话",
    async () => {
      const h = setup();
      h.fail("POST", "/warehouse/task/9/photo", "照片最多 30 张");
      const page = await h.open({ id: "9" });
      h.state.images = [["/tmp/1.jpg"]];
      await page.choosePhotos();
      assert.deepStrictEqual(h.state.toasts, ["照片最多 30 张"]);
      assert.strictEqual(page.data.uploading, false);
    }
  ],
  [
    "取消选图不提示",
    async () => {
      const h = setup();
      const page = await h.open({ id: "9" });
      await page.choosePhotos();
      assert.deepStrictEqual(h.state.toasts, []);
      assert.strictEqual(page.data.uploading, false);
    }
  ],
  [
    "删自己的照片：确认后删除并刷新；取消就不删",
    async () => {
      const h = setup();
      h.respond("DELETE", "/warehouse/task/9/photo/5", { success: true });
      const page = await h.open({ id: "9" });
      h.state.modalConfirm = false;
      await page.deletePhoto(h.event({ id: 5 }));
      assert.deepStrictEqual(h.callsTo("DELETE", "/photo/5"), []);
      h.state.modalConfirm = true;
      await page.deletePhoto(h.event({ id: 5 }));
      assert.strictEqual(h.callsTo("DELETE", "/warehouse/task/9/photo/5").length, 1);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
    }
  ],
  [
    "点缩略图看大图",
    async () => {
      const h = setup();
      const page = await h.open({ id: "9" });
      page.previewPhoto(h.event({ index: 0 }));
      assert.deepStrictEqual(h.state.previews, [
        { urls: ["signed:wh-task/a.jpg"], current: "signed:wh-task/a.jpg" }
      ]);
    }
  ],
  [
    "照片不够时提交：提示还差几张，不发请求",
    async () => {
      const h = setup();
      const page = await h.open({ id: "9" });
      page.onResult(h.event({ value: "pass" }));
      page.onNoteInput(h.event({}, { value: "正常" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["还差 2 张照片"]);
      assert.deepStrictEqual(h.callsTo("POST", "/submit"), []);
    }
  ],
  [
    "提交成功：等库管确认",
    async () => {
      const h = setup({ ...baseTask, photo_count: 3 });
      h.respond("POST", "/warehouse/task/9/submit", {
        success: true,
        data: { status: "submitted", followup_task_id: null }
      });
      const page = await h.open({ id: "9" });
      page.onResult(h.event({ value: "pass" }));
      page.onNoteInput(h.event({}, { value: " 正常 " }));
      await page.submit();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/submit")[0].data, {
        version: 2,
        result: "pass",
        result_note: "正常"
      });
      assert.deepStrictEqual(h.state.toasts, ["已提交，等库管确认"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
      assert.deepStrictEqual(page.data.form, { result: "", systems: [], resultNote: "" });
    }
  ],
  [
    "库管自己做不合格的检查：已完成，并提示生成了维修任务",
    async () => {
      const h = setup({ ...baseTask, photo_count: 3, assignee_userid: "lz" }, { username: "lz", roles: ["operator"] }, { is_keeper: true });
      h.respond("POST", "/warehouse/task/9/submit", {
        success: true,
        data: { status: "done", followup_task_id: 12 }
      });
      const page = await h.open({ id: "9" });
      page.onResult(h.event({ value: "fail" }));
      page.onNoteInput(h.event({}, { value: "主轴漏油" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["已完成，已生成维修任务"]);
    }
  ],
  [
    "维修任务要勾系统",
    async () => {
      const h = setup({ ...baseTask, kind: "maintenance", required_photo_count: 0, photo_count: 0, photos: [] });
      h.respond("POST", "/warehouse/task/9/submit", { success: true, data: { status: "submitted", followup_task_id: null } });
      const page = await h.open({ id: "9" });
      page.onNoteInput(h.event({}, { value: "换了油封" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["请选择维修涉及的系统"]);
      page.toggleSystem(h.event({ key: "hydraulic" }));
      page.toggleSystem(h.event({ key: "drive" }));
      page.toggleSystem(h.event({ key: "drive" }));
      assert.deepStrictEqual(page.data.systemOptions.map((item) => item.active), [true, false, false, false]);
      await page.submit();
      assert.deepStrictEqual(h.callsTo("POST", "/warehouse/task/9/submit")[0].data, {
        version: 2,
        systems: ["hydraulic"],
        result_note: "换了油封"
      });
    }
  ],
  [
    "提交时任务已经被别人动过：提示并重新加载，忙碌状态复位",
    async () => {
      const h = setup({ ...baseTask, photo_count: 3 });
      h.fail("POST", "/warehouse/task/9/submit", "数据已变化，请刷新后重试", 409);
      const page = await h.open({ id: "9" });
      page.onResult(h.event({ value: "pass" }));
      page.onNoteInput(h.event({}, { value: "正常" }));
      await page.submit();
      assert.deepStrictEqual(h.state.toasts, ["数据已变化，请刷新后重试"]);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.callsTo("GET", "/warehouse/task/9").length, 2);
    }
  ],
  [
    "连点两次提交只发一次",
    async () => {
      const h = setup({ ...baseTask, photo_count: 3 });
      h.respond("POST", "/warehouse/task/9/submit", { success: true, data: { status: "submitted", followup_task_id: null } });
      const page = await h.open({ id: "9" });
      page.onResult(h.event({ value: "pass" }));
      page.onNoteInput(h.event({}, { value: "正常" }));
      await Promise.all([page.submit(), page.submit()]);
      assert.strictEqual(h.callsTo("POST", "/warehouse/task/9/submit").length, 1);
    }
  ],
  [
    "旁观者没有提交区，点设备进设备页",
    async () => {
      const h = setup(baseTask, { username: "zhao", roles: ["operator"] });
      const page = await h.open({ id: "9" });
      assert.strictEqual(page.data.view.actions.canWork, false);
      assert.strictEqual(page.data.photos[0].canDelete, false);
      page.openDevice();
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/device/index?id=7"]);
    }
  ]
]);
