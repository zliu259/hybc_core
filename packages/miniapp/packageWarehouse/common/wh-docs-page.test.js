/** 设备资料列表页的流程测试。运行：node packageWarehouse/common/wh-docs-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const docOf = (id, patch = {}) => ({
  id,
  title: `资料 ${id}`,
  file_name: `资料${id}.pdf`,
  file_size: 2048,
  content_type: "application/pdf",
  doc_category: "manual",
  scope: "general",
  device_code: null,
  device_name: null,
  category_name: null,
  validity: "none",
  is_latest: true,
  ...patch
});
const listOf = (ids, total) => ({
  success: true,
  data: ids.map((id) => docOf(id)),
  pagination: { page: 1, pageSize: 20, total }
});

const setup = (caps = { is_doc_admin: false }) => {
  const h = createPageHarness({ page: "packageWarehouse/docs/index" });
  h.respond("GET", "/doc-library/file?", listOf([1, 2], 2));
  h.respond("GET", "/warehouse/me", { success: true, data: caps });
  return h;
};
const listCalls = (h) => h.callsTo("GET", "/doc-library/file?").map((call) => call.path);

runTests("wh-docs-page", [
  [
    "不带参数：看全库，第一页 20 条",
    async () => {
      const h = setup();
      const page = await h.open({});
      assert.deepStrictEqual(listCalls(h), ["/api/v1/doc-library/file?page=1&pageSize=20"]);
      assert.strictEqual(page.data.deviceMode, false);
      assert.strictEqual(page.data.rows.length, 2);
      assert.deepStrictEqual(page.data.rows[0], {
        id: 1,
        title: "资料 1",
        categoryLabel: "说明书",
        ownerText: "通用",
        sizeText: "2 KB",
        validityText: "",
        expired: false,
        soon: false
      });
      assert.strictEqual(page.data.tabs.length, 7);
      assert.strictEqual(page.data.activeTab, "");
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.finished, true);
    }
  ],
  [
    "切资料类别：回到第一页按类别查；再点同一个不重复查",
    async () => {
      const h = setup();
      const page = await h.open({});
      await page.onTab(h.event({ key: "cert" }));
      assert.strictEqual(listCalls(h)[1], "/api/v1/doc-library/file?doc_category=cert&page=1&pageSize=20");
      assert.strictEqual(page.data.activeTab, "cert");
      await page.onTab(h.event({ key: "cert" }));
      assert.strictEqual(listCalls(h).length, 2);
      await page.onTab(h.event({ key: "" }));
      assert.strictEqual(listCalls(h)[2], "/api/v1/doc-library/file?page=1&pageSize=20");
    }
  ],
  [
    "搜索：停一下才查，带着当前的类别",
    async () => {
      const h = setup();
      const page = await h.open({});
      await page.onTab(h.event({ key: "manual" }));
      page.onSearchInput(h.event({}, { value: "说" }));
      page.onSearchInput(h.event({}, { value: "说明书" }));
      await h.flush(350);
      assert.strictEqual(listCalls(h).length, 3);
      assert.strictEqual(
        listCalls(h)[2],
        "/api/v1/doc-library/file?keyword=%E8%AF%B4%E6%98%8E%E4%B9%A6&doc_category=manual&page=1&pageSize=20"
      );
    }
  ],
  [
    "触底加载下一页并追加；到底了不再请求",
    async () => {
      const h = setup();
      h.respond("GET", "/doc-library/file?", (call) =>
        call.path.includes("page=2")
          ? listOf([21], 21)
          : listOf(Array.from({ length: 20 }, (_, index) => index + 1), 21)
      );
      const page = await h.open({});
      assert.strictEqual(page.data.finished, false);
      await page.onReachBottom();
      assert.strictEqual(page.data.rows.length, 21);
      assert.strictEqual(page.data.finished, true);
      await page.onReachBottom();
      assert.strictEqual(listCalls(h).length, 2);
    }
  ],
  [
    "带 deviceId：看这台设备适用的资料，分三段，标题是设备编号",
    async () => {
      const h = setup();
      h.respond("GET", "/doc-library/for-device/7", {
        success: true,
        data: [
          docOf(1, { scope: "device", device_code: "SB-0007", device_name: "唐兴" }),
          docOf(2, { scope: "device", device_code: "SB-0007", device_name: "唐兴", validity: "expired" }),
          docOf(3, { scope: "general" })
        ]
      });
      const page = await h.open({ deviceId: "7", code: "SB-0007" });
      assert.deepStrictEqual(h.callsTo("GET", "/doc-library/").map((call) => call.path), [
        "/api/v1/doc-library/for-device/7"
      ]);
      assert.strictEqual(page.data.deviceMode, true);
      assert.deepStrictEqual(
        page.data.groups.map((group) => [group.label, group.rows.map((row) => row.id)]),
        [
          ["这台设备", [1, 2]],
          ["通用", [3]]
        ]
      );
      assert.strictEqual(page.data.groups[0].rows[1].expired, true);
      assert.deepStrictEqual(h.state.titles, ["SB-0007 的资料"]);
      // 设备的资料一次给全，触底和搜索都不请求
      await page.onReachBottom();
      assert.strictEqual(h.callsTo("GET", "/doc-library/").length, 1);
    }
  ],
  [
    "这台设备还没有资料",
    async () => {
      const h = setup();
      h.respond("GET", "/doc-library/for-device/7", { success: true, data: [] });
      const page = await h.open({ deviceId: "7" });
      assert.deepStrictEqual(page.data.groups, []);
      assert.strictEqual(page.data.loadFailed, false);
      assert.deepStrictEqual(h.state.titles, ["设备资料"]);
    }
  ],
  [
    "加载失败：有提示，页面上写着加载失败，下拉后恢复",
    async () => {
      const h = setup();
      h.failOnce("GET", "/doc-library/file?", "服务器出错，请稍后重试", 500);
      const page = await h.open({});
      assert.strictEqual(page.data.loadFailed, true);
      assert.deepStrictEqual(page.data.rows, []);
      assert.ok(h.state.toasts.includes("服务器出错，请稍后重试"));
      await page.onPullDownRefresh();
      assert.strictEqual(page.data.loadFailed, false);
      assert.strictEqual(page.data.rows.length, 2);
      assert.strictEqual(h.state.pullStops, 1);
    }
  ],
  [
    "设备的资料加载失败也一样",
    async () => {
      const h = setup();
      h.failOnce("GET", "/doc-library/for-device/7", "设备不存在", 404);
      const page = await h.open({ deviceId: "7" });
      assert.strictEqual(page.data.loadFailed, true);
      assert.ok(h.state.toasts.includes("设备不存在"));
    }
  ],
  [
    "点一条进详情",
    async () => {
      const h = setup();
      const page = await h.open({});
      page.openDoc(h.event({ id: 2 }));
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/doc-view/index?id=2"]);
    }
  ],
  [
    "资料管理员才有上传入口",
    async () => {
      const admin = await setup({ is_doc_admin: true }).open({});
      assert.strictEqual(admin.data.canUpload, true);
      const staff = await setup({ is_doc_admin: false }).open({});
      assert.strictEqual(staff.data.canUpload, false);
    }
  ],
  [
    "权限取不到不影响看资料",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/me", "网络错误", 500);
      const page = await h.open({});
      assert.strictEqual(page.data.rows.length, 2);
      assert.strictEqual(page.data.canUpload, false);
    }
  ],
  [
    "上一趟还没回来又换了类别：等它回来按新的类别再查一次",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/docs/index" });
      h.respond("GET", "/warehouse/me", { success: true, data: {} });
      h.respond("GET", "/doc-library/file?", async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return listOf([1], 1);
      });
      const opening = h.open({});
      await h.flush(10);
      const page = await opening;
      const first = page.onTab(h.event({ key: "cert" }));
      await h.flush(10);
      await page.onTab(h.event({ key: "report" }));
      await first;
      await h.flush(200);
      const paths = listCalls(h);
      assert.strictEqual(paths[paths.length - 1], "/api/v1/doc-library/file?doc_category=report&page=1&pageSize=20");
      assert.strictEqual(page.data.loading, false);
    }
  ]
]);
