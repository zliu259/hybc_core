/** 设备资料查看页的流程测试。运行：node packageWarehouse/common/wh-doc-view-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const MB = 1024 * 1024;
const URL = "https://api.hybcdg.com/api/v1/upload/object/doc-library%2Fk?expires=1&signature=s&filename=a";
const detail = (patch = {}) => ({
  id: 5,
  title: "使用说明书",
  file_name: "说明书.pdf",
  file_size: 3 * MB,
  content_type: "application/pdf",
  doc_category: "manual",
  scope: "device",
  device_code: "SB-0007",
  device_name: "唐兴",
  category_name: null,
  valid_until: null,
  validity: "none",
  is_latest: true,
  uploaded_by_userid: "liu",
  created_at: "2026-11-12T01:05:00.000Z",
  history: [],
  ...patch
});

const setup = (doc = detail()) => {
  const h = createPageHarness({ page: "packageWarehouse/doc-view/index" });
  h.respond("GET", "/doc-library/file/5", { success: true, data: doc });
  h.respond("GET", "/doc-library/file/5/url", { success: true, data: { url: URL } });
  h.respond("GET", "/wecom/contacts", { success: true, data: { users: [{ userid: "liu", name: "刘工" }] } });
  return h;
};
const urlCalls = (h) => h.callsTo("GET", "/doc-library/file/5/url").length;

runTests("wh-doc-view-page", [
  [
    "打开页面：标题、归属、大小、上传人，标题栏是资料标题",
    async () => {
      const h = setup(detail({ valid_until: "2026-11-01", validity: "expired" }));
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.view.title, "使用说明书");
      assert.strictEqual(page.data.view.ownerText, "SB-0007 唐兴");
      assert.strictEqual(page.data.view.sizeText, "3 MB");
      assert.strictEqual(page.data.view.uploadText, "刘工 2026-11-12");
      assert.strictEqual(page.data.view.expired, true);
      assert.strictEqual(page.data.view.kind, "document");
      assert.deepStrictEqual(h.state.titles, ["使用说明书"]);
      // 打开页面不取文件地址，点「打开」才取
      assert.strictEqual(urlCalls(h), 0);
    }
  ],
  [
    "图片：取到地址后预览，不下载",
    async () => {
      const h = setup(detail({ file_name: "铭牌.jpg", content_type: "image/jpeg" }));
      const page = await h.open({ id: "5" });
      await page.onOpen();
      assert.deepStrictEqual(h.state.previews, [{ urls: [URL], current: URL }]);
      assert.deepStrictEqual(h.state.downloads, []);
      assert.strictEqual(page.data.opening, false);
    }
  ],
  [
    "视频：在页面里放，不下载",
    async () => {
      const h = setup(detail({ file_name: "演示.mp4", content_type: "video/mp4" }));
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.videoUrl, "");
      await page.onOpen();
      assert.strictEqual(page.data.videoUrl, URL);
      assert.deepStrictEqual(h.state.downloads, []);
    }
  ],
  [
    "文档：下载后用系统打开，带上文件类型和菜单",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      const seen = [];
      const original = global.wx.openDocument;
      global.wx.openDocument = (options) => {
        seen.push({ filePath: options.filePath, fileType: options.fileType, showMenu: options.showMenu });
        original(options);
      };
      await page.onOpen();
      assert.deepStrictEqual(h.state.downloads, [URL]);
      assert.deepStrictEqual(seen, [{ filePath: "/tmp/download-1", fileType: "pdf", showMenu: true }]);
      assert.deepStrictEqual(h.state.opened, ["/tmp/download-1"]);
      assert.strictEqual(page.data.opening, false);
    }
  ],
  [
    "同一份文档再点打开：用已经下好的，不再下载",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      await page.onOpen();
      await page.onOpen();
      assert.strictEqual(h.state.downloads.length, 1);
      assert.strictEqual(h.state.opened.length, 2);
      assert.strictEqual(urlCalls(h), 1);
    }
  ],
  [
    "连点两次「打开」只下载一次",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      await Promise.all([page.onOpen(), page.onOpen()]);
      assert.strictEqual(h.state.downloads.length, 1);
      assert.strictEqual(h.state.opened.length, 1);
    }
  ],
  [
    "下载失败：提示，按钮恢复，再点能重新下（重新取地址）",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      h.state.downloadFail = { errMsg: "downloadFile:fail timeout" };
      await page.onOpen();
      assert.ok(h.state.toasts.includes("下载失败，请检查网络后再试"));
      assert.strictEqual(page.data.opening, false);
      assert.deepStrictEqual(h.state.opened, []);
      await page.onOpen();
      assert.strictEqual(h.state.downloads.length, 2);
      assert.strictEqual(h.state.opened.length, 1);
      assert.strictEqual(urlCalls(h), 2);
    }
  ],
  [
    "下载回的不是文件（地址过期）：提示再点一次",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      h.state.downloadFail = 401;
      await page.onOpen();
      assert.ok(h.state.toasts.includes("下载失败，请再点一次"));
      assert.deepStrictEqual(h.state.opened, []);
    }
  ],
  [
    "这台设备打不开（企微电脑端）：说清楚去哪儿看",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      h.state.openDocumentFail = { errMsg: "openDocument:fail" };
      await page.onOpen();
      assert.deepStrictEqual(h.state.modals, [
        { title: "这里打不开这个文件", content: "请用手机，或者在电脑上用网页版打开。" }
      ]);
      assert.strictEqual(page.data.opening, false);
    }
  ],
  [
    "这里打不开之后再点：重新下载，不拿上次那个文件接着试",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      h.state.openDocumentFail = { errMsg: "openDocument:fail" };
      await page.onOpen();
      h.state.openDocumentFail = null;
      await page.onOpen();
      assert.strictEqual(h.state.downloads.length, 2);
      assert.deepStrictEqual(h.state.opened, ["/tmp/download-2"]);
    }
  ],
  [
    "下载到一半离开页面：下载停掉，不会过一会儿在别的页面上弹出文件",
    async () => {
      const h = setup();
      const page = await h.open({ id: "5" });
      h.state.downloadDelayMs = 40;
      const opening = page.onOpen();
      await h.flush(10);
      assert.strictEqual(h.state.downloads.length, 1);
      page.onUnload();
      await opening;
      await h.flush(60);
      assert.strictEqual(h.state.downloadAborts, 1);
      assert.deepStrictEqual(h.state.opened, []);
      assert.deepStrictEqual(h.state.modals, []);
      assert.deepStrictEqual(h.state.toasts, []);
    }
  ],
  [
    "还在取地址的时候离开页面：不下载、不预览",
    async () => {
      const h = setup(detail({ file_name: "铭牌.jpg", content_type: "image/jpeg" }));
      const page = await h.open({ id: "5" });
      h.respond("GET", "/doc-library/file/5/url", () => {
        page.onUnload();
        return { success: true, data: { url: URL } };
      });
      await page.onOpen();
      assert.deepStrictEqual(h.state.previews, []);
      assert.deepStrictEqual(h.state.downloads, []);
    }
  ],
  [
    "取文件地址失败：提示原因，不下载",
    async () => {
      const h = setup();
      h.fail("GET", "/doc-library/file/5/url", "资料不存在", 404);
      const page = await h.open({ id: "5" });
      await page.onOpen();
      assert.ok(h.state.toasts.includes("资料不存在"));
      assert.deepStrictEqual(h.state.downloads, []);
      assert.strictEqual(page.data.opening, false);
    }
  ],
  [
    "不支持的类型：提示到电脑上打开，不取地址不下载",
    async () => {
      const h = setup(detail({ file_name: "图纸.dwg", content_type: "application/acad" }));
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.view.kind, "unsupported");
      await page.onOpen();
      assert.ok(h.state.toasts.includes("这种文件请在电脑上打开"));
      assert.strictEqual(urlCalls(h), 0);
      assert.deepStrictEqual(h.state.downloads, []);
    }
  ],
  [
    "大文件先问：不下就什么都不做，要下才下",
    async () => {
      const h = setup(detail({ file_size: 80 * MB }));
      const page = await h.open({ id: "5" });
      h.state.modalConfirm = false;
      await page.onOpen();
      assert.deepStrictEqual(h.state.modals, [
        { title: "文件有 80 MB", content: "要下载吗？不在 Wi-Fi 下会用掉不少流量。" }
      ]);
      assert.deepStrictEqual(h.state.downloads, []);
      assert.strictEqual(urlCalls(h), 0);
      assert.strictEqual(page.data.opening, false);
      h.state.modalConfirm = true;
      await page.onOpen();
      assert.strictEqual(h.state.downloads.length, 1);
      assert.strictEqual(h.state.opened.length, 1);
    }
  ],
  [
    "有旧版本：列出来，点开看那一版",
    async () => {
      const h = setup(
        detail({
          history: [detail({ id: 4, file_name: "说明书-旧.pdf", is_latest: false, created_at: "2025-01-02T03:00:00.000Z" })]
        })
      );
      const page = await h.open({ id: "5" });
      assert.deepStrictEqual(page.data.view.history, [
        { id: 4, fileName: "说明书-旧.pdf", sizeText: "3 MB", uploadText: "刘工 2025-01-02" }
      ]);
      page.openHistory(h.event({ id: 4 }));
      assert.deepStrictEqual(h.state.navigations, ["/packageWarehouse/doc-view/index?id=4"]);
    }
  ],
  [
    "资料不存在：写着没有找到",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/doc-view/index" });
      h.fail("GET", "/doc-library/file/5", "资料不存在", 404);
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.notFound, true);
      assert.strictEqual(page.data.view, null);
      await page.onOpen();
      assert.deepStrictEqual(h.state.downloads, []);
    }
  ],
  [
    "参数不对也是没有找到，不发请求",
    async () => {
      const h = setup();
      const page = await h.open({ id: "abc" });
      assert.strictEqual(page.data.notFound, true);
      assert.strictEqual(h.callsTo("GET", "/doc-library/").length, 0);
    }
  ],
  [
    "加载失败（不是不存在）：写着加载失败，下拉后恢复",
    async () => {
      const h = setup();
      h.failOnce("GET", "/doc-library/file/5", "服务器出错，请稍后重试", 500);
      const page = await h.open({ id: "5" });
      assert.strictEqual(page.data.loadFailed, true);
      assert.strictEqual(page.data.notFound, false);
      await page.onPullDownRefresh();
      assert.strictEqual(page.data.loadFailed, false);
      assert.strictEqual(page.data.view.title, "使用说明书");
    }
  ],
  [
    "视频放不了：提示，收起播放器，可以再点打开",
    async () => {
      const h = setup(detail({ file_name: "演示.mp4", content_type: "video/mp4" }));
      const page = await h.open({ id: "5" });
      await page.onOpen();
      page.onVideoError();
      assert.strictEqual(page.data.videoUrl, "");
      assert.ok(h.state.toasts.includes("视频放不了，再点一次「打开」试试"));
      await page.onOpen();
      assert.strictEqual(page.data.videoUrl, URL);
      assert.strictEqual(urlCalls(h), 2);
    }
  ]
]);
