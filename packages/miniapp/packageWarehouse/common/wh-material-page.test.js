/** 库存页的流程测试。运行：node packageWarehouse/common/wh-material-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const rowOf = (id) => ({ id, name: `物资 ${id}`, spec: "", unit: "个", kind: "turnover", quantity: id, min_stock: 5 });
const listOf = (ids, total) => ({ success: true, data: ids.map(rowOf), pagination: { page: 1, pageSize: 30, total } });

const setup = () => {
  const h = createPageHarness({ page: "packageWarehouse/material/index" });
  h.respond("GET", "/warehouse/material?", listOf([1, 2], 2));
  return h;
};
const listCalls = (h) => h.callsTo("GET", "/warehouse/material?").map((call) => call.path);

runTests("wh-material-page", [
  [
    "带 low 参数：只看低库存，开关是开的",
    async () => {
      const h = setup();
      const page = await h.open({ low: "1" });
      assert.deepStrictEqual(listCalls(h), ["/api/v1/warehouse/material?low_stock=1&status=active&page=1&pageSize=30"]);
      assert.strictEqual(page.data.lowOnly, true);
      assert.strictEqual(page.data.rows.length, 2);
      assert.strictEqual(page.data.rows[0].low, true);
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "不带参数看全部；输入关键字后停一下才查，列表换掉",
    async () => {
      const h = setup();
      const page = await h.open({});
      assert.deepStrictEqual(listCalls(h), ["/api/v1/warehouse/material?status=active&page=1&pageSize=30"]);
      page.onSearchInput(h.event({}, { value: "钢" }));
      page.onSearchInput(h.event({}, { value: "钢管" }));
      await h.flush(350);
      assert.deepStrictEqual(listCalls(h)[1], "/api/v1/warehouse/material?keyword=%E9%92%A2%E7%AE%A1&status=active&page=1&pageSize=30");
      assert.strictEqual(listCalls(h).length, 2);
    }
  ],
  [
    "触底加载并追加；关掉只看低库存回到第一页",
    async () => {
      const h = setup();
      h.respond("GET", "/warehouse/material?", (call) =>
        call.path.includes("page=2") ? listOf([31], 31) : listOf(Array.from({ length: 30 }, (_, i) => i + 1), 31)
      );
      const page = await h.open({ low: "1" });
      await page.onReachBottom();
      assert.strictEqual(page.data.rows.length, 31);
      assert.strictEqual(page.data.finished, true);
      await page.onReachBottom();
      assert.strictEqual(listCalls(h).length, 2);
      await page.onLowToggle(h.event({}, { value: false }));
      assert.strictEqual(listCalls(h)[2], "/api/v1/warehouse/material?status=active&page=1&pageSize=30");
      assert.strictEqual(page.data.lowOnly, false);
      assert.strictEqual(page.data.rows.length, 30);
    }
  ],
  [
    "上一趟还没回来又改了关键字：等它回来再按新的关键字查一次，不丢",
    async () => {
      const h = createPageHarness({ page: "packageWarehouse/material/index" });
      h.respond("GET", "/warehouse/material?", async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return listOf([1], 1);
      });
      const page = await h.open({});
      page.onSearchInput(h.event({}, { value: "钢管" }));
      // 300ms 后发出第一次搜索，它要 400ms 才回来；这期间又改了输入，第二次搜索到点时第一次还在路上
      await h.flush(320);
      page.onSearchInput(h.event({}, { value: "钢管 114" }));
      await h.flush(1200);
      const paths = listCalls(h);
      assert.strictEqual(paths[paths.length - 1], "/api/v1/warehouse/material?keyword=%E9%92%A2%E7%AE%A1%20114&status=active&page=1&pageSize=30");
      assert.strictEqual(page.data.loading, false);
    }
  ],
  [
    "加载失败有提示",
    async () => {
      const h = setup();
      h.fail("GET", "/warehouse/material?", "网络连接失败");
      const page = await h.open({});
      assert.deepStrictEqual(h.state.toasts, ["网络连接失败"]);
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.loadFailed, true);
    }
  ]
]);
