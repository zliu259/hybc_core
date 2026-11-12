/** 小程序上传设备资料页的流程测试。运行：node packageWarehouse/common/wh-doc-upload-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const MB = 1024 * 1024;
const CONFIG = {
  part_size: 8 * MB,
  max_bytes: 2048 * MB,
  max_bytes_miniapp: 200 * MB,
  categories: [
    { key: "cert", label: "合格证" },
    { key: "report", label: "检测报告" },
    { key: "params", label: "技术参数" },
    { key: "manual", label: "说明书" },
    { key: "maintenance", label: "保养维修" },
    { key: "other", label: "其他" }
  ],
  extensions: ["pdf", "jpg", "jpeg", "png", "docx", "mp4"]
};
const DEVICE = { id: 7, device_code: "SB-0007", name: "唐兴" };

const setup = (caps = { is_doc_admin: true }) => {
  const h = createPageHarness({ page: "packageWarehouse/doc-upload/index" });
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  h.respond("GET", "/doc-library/config", { success: true, data: CONFIG });
  h.respond("GET", "/warehouse/device/7", { success: true, data: DEVICE });
  h.respond("GET", "/warehouse/device?", { success: true, data: [DEVICE, { id: 8, device_code: "SB-0008", name: "老三号" }] });
  h.respond("GET", "/warehouse/device-category", {
    success: true,
    data: [
      { id: 2, name: "顶管机", status: "active" },
      { id: 3, name: "泥浆泵", status: "active" },
      { id: 4, name: "停用的", status: "disabled" }
    ]
  });
  h.respond("POST", "/doc-library/upload/init", (call) => ({
    success: true,
    data: { upload_token: "tok", part_size: 8 * MB, part_count: Math.ceil(call.data.file_size / (8 * MB)) }
  }));
  h.respond("POST", "/doc-library/upload/complete", { success: true, data: { id: 31, replayed: false } });
  h.respond("POST", "/doc-library/upload/abort", { success: true });
  return h;
};
const pick = async (h, page, file) => {
  h.state.messageFiles.push(file);
  await page.chooseFile();
};
const PDF = { path: "/tmp/cert.pdf", name: "出厂合格证.pdf", size: 12 * MB };
const sequence = (h) =>
  h.state.calls
    .filter((call) => call.path.includes("/doc-library/upload/"))
    .map((call) => `${call.method} ${call.path.replace(/^.*\/upload\//, "").replace(/token=[^&]+/, "token=T")}`);

runTests("wh-doc-upload-page", [
  [
    "不是资料管理员：只看到没有权限的提示，什么也传不了",
    async () => {
      const h = setup({ is_doc_admin: false });
      const page = await h.open({});
      assert.strictEqual(page.data.denied, true);
      await page.chooseFile();
      await page.submit();
      assert.strictEqual(h.callsTo("POST", "/doc-library/upload/").length, 0);
    }
  ],
  [
    "从设备页进来：归属定死这台设备",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      assert.strictEqual(page.data.denied, false);
      assert.strictEqual(page.data.form.locked, true);
      assert.strictEqual(page.data.form.ownerKind, "device");
      assert.strictEqual(page.data.form.deviceId, 7);
      assert.strictEqual(page.data.form.deviceText, "SB-0007 唐兴");
      // 定死了就不能换归属
      page.onOwnerKind(h.event({ kind: "general" }));
      assert.strictEqual(page.data.form.ownerKind, "device");
    }
  ],
  [
    "不带设备进来：默认归到某台设备，要自己搜着选；也能改成某类设备或通用",
    async () => {
      const h = setup();
      const page = await h.open({});
      assert.strictEqual(page.data.form.locked, false);
      assert.strictEqual(page.data.form.deviceId, null);
      assert.deepStrictEqual(page.data.deviceOptions.range, ["SB-0007 唐兴", "SB-0008 老三号"]);
      await page.onDeviceSearch(h.event({}, { keyword: "老三" }));
      assert.strictEqual(h.callsTo("GET", "/warehouse/device?").pop().path, "/api/v1/warehouse/device?keyword=%E8%80%81%E4%B8%89&pageSize=20");
      page.onDevicePick(h.event({}, { value: 1 }));
      assert.deepStrictEqual([page.data.form.deviceId, page.data.form.deviceText], [8, "SB-0008 老三号"]);

      page.onOwnerKind(h.event({ kind: "category" }));
      assert.strictEqual(page.data.form.ownerKind, "category");
      // 停用的类别不给选
      assert.deepStrictEqual(page.data.deviceCategories.range, ["顶管机", "泥浆泵"]);
      page.onDeviceCategoryPick(h.event({}, { value: 1 }));
      assert.strictEqual(page.data.form.deviceCategoryId, 3);
      page.onOwnerKind(h.event({ kind: "general" }));
      assert.strictEqual(page.data.form.ownerKind, "general");
    }
  ],
  [
    "选了文件：显示名字和大小，标题默认文件名，资料类别按文件名猜，合格证能填有效期",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      assert.deepStrictEqual(page.data.form.file, PDF);
      assert.strictEqual(page.data.fileText, "出厂合格证.pdf（12 MB）");
      assert.strictEqual(page.data.form.title, "出厂合格证");
      assert.strictEqual(page.data.form.category, "cert");
      assert.strictEqual(page.data.categoryIndex, 0);
      assert.strictEqual(page.data.showValidity, true);
      page.onCategoryPick(h.event({}, { value: 3 }));
      assert.strictEqual(page.data.form.category, "manual");
      assert.strictEqual(page.data.showValidity, false);
      // 自己改过的标题和类别，换文件时不覆盖
      page.onTitleInput(h.event({}, { value: "我起的标题" }));
      await pick(h, page, { path: "/tmp/b.pdf", name: "检测报告.pdf", size: 1024 });
      assert.strictEqual(page.data.form.title, "我起的标题");
      assert.strictEqual(page.data.form.category, "manual");
      assert.strictEqual(page.data.fileText, "检测报告.pdf（1 KB）");
    }
  ],
  [
    "取消选文件什么都不变，不提示",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      await page.chooseFile();
      assert.strictEqual(page.data.form.file, null);
      assert.deepStrictEqual(h.state.toasts, []);
    }
  ],
  [
    "超过手机上限、类型不支持的文件：当场说清楚，不算选上",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, { path: "/tmp/big.mp4", name: "大视频.mp4", size: 201 * MB });
      assert.deepStrictEqual(h.state.modals.pop(), {
        title: "这个文件传不了",
        content: "文件超过 200 MB，手机上传不了，请在电脑上用网页版上传"
      });
      assert.strictEqual(page.data.form.file, null);
      await pick(h, page, { path: "/tmp/a.exe", name: "安装程序.exe", size: 10 });
      assert.strictEqual(h.state.modals.pop().content, "不支持 .exe 文件");
      assert.strictEqual(page.data.form.file, null);
      await page.submit();
      assert.ok(h.state.toasts.includes("请选择文件"));
      assert.strictEqual(h.callsTo("POST", "/doc-library/upload/init").length, 0);
    }
  ],
  [
    "拍照或相册：大小现查，名字用「照片-时间」，标题要自己填",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      h.state.images.push(["/tmp/wx-abc.jpg"]);
      h.state.fileSizes["/tmp/wx-abc.jpg"] = 3 * MB;
      await page.choosePhoto();
      assert.strictEqual(page.data.form.file.path, "/tmp/wx-abc.jpg");
      assert.strictEqual(page.data.form.file.size, 3 * MB);
      assert.ok(/^照片-\d{8}-\d{6}\.jpg$/.test(page.data.form.file.name), page.data.form.file.name);
      assert.strictEqual(page.data.form.title, "");
      await page.submit();
      assert.ok(h.state.toasts.includes("请填写标题"));
      assert.strictEqual(h.callsTo("POST", "/doc-library/upload/init").length, 0);
    }
  ],
  [
    "走完一次上传：初始化、一片一片传、完成，成功后回到上一页",
    async () => {
      const h = setup();
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      page.onValidUntil(h.event({}, { value: "2027-06-30" }));
      await page.submit();
      await h.flush(900);
      assert.deepStrictEqual(sequence(h), [
        "POST init",
        "PUT part?token=T&part=1",
        "PUT part?token=T&part=2",
        "POST complete"
      ]);
      assert.deepStrictEqual(h.callsTo("POST", "/upload/init")[0].data, {
        file_name: "出厂合格证.pdf",
        file_size: 12 * MB,
        client: "miniapp"
      });
      assert.deepStrictEqual(h.state.reads, [
        ["/tmp/cert.pdf", 0, 8 * MB],
        ["/tmp/cert.pdf", 8 * MB, 4 * MB]
      ]);
      assert.deepStrictEqual(
        h.callsTo("PUT", "/upload/part").map((call) => call.data),
        [
          { bytes: 8 * MB, timeout: 180000 },
          { bytes: 4 * MB, timeout: 180000 }
        ]
      );
      assert.deepStrictEqual(h.callsTo("POST", "/upload/complete")[0].data, {
        upload_token: "tok",
        parts: [
          { part_number: 1, etag: "etag-1" },
          { part_number: 2, etag: "etag-2" }
        ],
        title: "出厂合格证",
        doc_category: "cert",
        device_id: 7,
        device_category_id: null,
        valid_until: "2027-06-30"
      });
      assert.ok(h.state.toasts.includes("已上传"));
      assert.strictEqual(h.state.backs, 1);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.state.leaveAlert, false);
    }
  ],
  [
    "上传中：显示进度，开着离开前的提醒，连点不重复传",
    async () => {
      const h = setup();
      let release;
      h.respond("PUT", "/upload/part", (call) =>
        call.path.includes("part=2")
          ? new Promise((resolve) => {
              release = () => resolve({ success: true, data: { part_number: 2, etag: "etag-2" } });
            })
          : { success: true, data: { part_number: 1, etag: "etag-1" } }
      );
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      const running = page.submit();
      await h.flush(20);
      assert.strictEqual(page.data.busy, true);
      assert.strictEqual(page.data.progress, 66);
      assert.strictEqual(h.state.leaveAlert, true);
      await page.submit();
      await page.chooseFile();
      assert.strictEqual(h.callsTo("POST", "/upload/init").length, 1);
      release();
      await running;
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.state.leaveAlert, false);
      page.onUnload();
    }
  ],
  [
    "完成请求失败（超时）：提示、能再点，再点只重发完成请求，不重传",
    async () => {
      const h = setup();
      h.failOnce("POST", "/doc-library/upload/complete", "网络不通，请稍后重试", 0);
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      await page.submit();
      assert.ok(h.state.toasts.includes("网络不通，请稍后重试"));
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(h.state.backs, 0);
      assert.strictEqual(page.data.form.title, "出厂合格证");

      await page.submit();
      await h.flush(900);
      assert.strictEqual(h.callsTo("POST", "/upload/init").length, 1);
      assert.strictEqual(h.callsTo("PUT", "/upload/part").length, 2);
      assert.strictEqual(h.callsTo("POST", "/upload/complete").length, 2);
      assert.strictEqual(h.state.backs, 1);
    }
  ],
  [
    "完成时说标题不对：改好再点，分片不用重传",
    async () => {
      const h = setup();
      h.failOnce("POST", "/doc-library/upload/complete", "标题最多 120 个字", 400);
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      await page.submit();
      assert.ok(h.state.toasts.includes("标题最多 120 个字"));
      page.onTitleInput(h.event({}, { value: "合格证" }));
      await page.submit();
      assert.strictEqual(h.callsTo("PUT", "/upload/part").length, 2);
      assert.strictEqual(h.callsTo("POST", "/upload/complete")[1].data.title, "合格证");
      page.onUnload();
    }
  ],
  [
    "完成时说上传已失效：再点从头传",
    async () => {
      const h = setup();
      h.failOnce("POST", "/doc-library/upload/complete", "上传已失效，请重新上传", 403);
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      await page.submit();
      assert.ok(h.state.toasts.includes("上传已失效，请重新上传"));
      await page.submit();
      assert.strictEqual(h.callsTo("POST", "/upload/init").length, 2);
      assert.strictEqual(h.callsTo("PUT", "/upload/part").length, 4);
      page.onUnload();
    }
  ],
  [
    "某一片怎么都传不上：说是第几片，放弃这次上传，表单留着，再点重新来",
    async () => {
      const h = setup();
      h.fail("PUT", "/upload/part", "网络不通，请稍后重试", 0);
      const page = await h.open({ deviceId: "7" });
      page.retryDelayMs = 0;
      await pick(h, page, PDF);
      await page.submit();
      assert.ok(h.state.toasts.includes("第 1 片上传失败"));
      assert.strictEqual(h.callsTo("PUT", "/upload/part").length, 3);
      assert.strictEqual(h.callsTo("POST", "/upload/abort").length, 1);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(page.data.progress, 0);
      assert.deepStrictEqual(page.data.form.file, PDF);
      assert.strictEqual(h.state.leaveAlert, false);
    }
  ],
  [
    "换了文件：上一个文件传到一半的东西不再用",
    async () => {
      const h = setup();
      h.failOnce("POST", "/doc-library/upload/complete", "网络不通，请稍后重试", 0);
      const page = await h.open({ deviceId: "7" });
      await pick(h, page, PDF);
      await page.submit();
      await pick(h, page, { path: "/tmp/other.pdf", name: "说明书.pdf", size: 1024 });
      await page.submit();
      assert.strictEqual(h.callsTo("POST", "/upload/init").length, 2);
      assert.strictEqual(h.callsTo("POST", "/upload/init")[1].data.file_name, "说明书.pdf");
      // 旧的那次上传顺手放弃掉
      assert.strictEqual(h.callsTo("POST", "/upload/abort").length, 1);
      page.onUnload();
    }
  ],
  [
    "归到某类设备、通用：完成请求里只带选中的那一种",
    async () => {
      const h = setup();
      const page = await h.open({});
      await pick(h, page, { path: "/tmp/m.pdf", name: "操作手册.pdf", size: 1024 });
      await page.submit();
      assert.ok(h.state.toasts.includes("请选择设备"));
      page.onOwnerKind(h.event({ kind: "category" }));
      await page.submit();
      assert.ok(h.state.toasts.includes("请选择设备类别"));
      page.onDeviceCategoryPick(h.event({}, { value: 0 }));
      await page.submit();
      const sent = h.callsTo("POST", "/upload/complete")[0].data;
      assert.deepStrictEqual(
        [sent.device_id, sent.device_category_id, sent.doc_category, sent.valid_until],
        [null, 2, "manual", null]
      );
      page.onUnload();
    }
  ],
  [
    "上传设置取不到：说清楚，选文件时不让过",
    async () => {
      const h = setup();
      h.fail("GET", "/doc-library/config", "服务器出错，请稍后重试", 500);
      const page = await h.open({ deviceId: "7" });
      assert.ok(h.state.toasts.includes("服务器出错，请稍后重试"));
      await pick(h, page, PDF);
      assert.strictEqual(page.data.form.file, null);
      assert.strictEqual(h.state.modals.pop().content, "上传设置还没取到，请稍后再试");
    }
  ]
]);
