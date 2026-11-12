/** 盘点页的流程测试。运行：node packageWarehouse/common/wh-stocktake-page.test.js */
const assert = require("assert");

const { createPageHarness, runTests } = require("./wh-test-harness");

const BASE = "/api/v1/warehouse/stocktake";

const materialLine = (patch = {}) => ({
  id: 11,
  material_id: 1,
  counted_qty: null,
  book_qty: null,
  note: null,
  material_code: "WZ-0001",
  name: "水泥",
  spec: "P.O42.5",
  unit: "袋",
  category: "施工消耗材料",
  storage_note: null,
  current_qty: 10,
  diff: null,
  ...patch
});
const deviceLine = (patch = {}) => ({
  id: 21,
  device_id: 1,
  expected: 1,
  found: null,
  note: null,
  device_code: "SB-0001",
  device_name: "顶管机",
  alias: null,
  storage_note: null,
  location: "warehouse",
  project_name: null,
  ...patch
});
const detailOf = (patch = {}) => ({
  id: 5,
  stocktake_no: "PD-20261112-0001",
  scope: "all",
  status: "counting",
  version: 3,
  material_total: 2,
  material_counted: 0,
  material_diff: 0,
  device_expected: 2,
  device_found: 0,
  device_missing: 2,
  device_unexpected: 0,
  adjust_doc_no: null,
  material_lines: [materialLine(), materialLine({ id: 12, material_id: 2, name: "扳手", spec: "", unit: "把", current_qty: 3 })],
  device_lines: [deviceLine(), deviceLine({ id: 22, device_id: 2, device_code: "SB-0002" })],
  ...patch
});
const ok = (data) => ({ success: true, data });

/** 库管打开页面，已有一次进行中的盘点 */
const setup = ({ keeper = true, counting = true, detail = detailOf() } = {}) => {
  const h = createPageHarness({ page: "packageWarehouse/stocktake/index" });
  h.respond("GET", "/warehouse/me", ok({ is_keeper: keeper }));
  h.respond("GET", `${BASE}?`, {
    success: true,
    data: counting ? [{ id: detail.id, stocktake_no: detail.stocktake_no }] : [],
    pagination: { page: 1, pageSize: 1, total: counting ? 1 : 0 }
  });
  h.respond("GET", `${BASE}/${detail.id}`, ok(detail));
  return h;
};
const posts = (h, suffix) => h.callsTo("POST", `${BASE}${suffix}`);

runTests("wh-stocktake-page", [
  [
    "没有进行中的盘点：库管看到三个发起按钮；点「都盘」确认后发 POST，然后显示这次盘点",
    async () => {
      const h = setup({ counting: false });
      h.respond("POST", BASE, ok(detailOf()));
      const page = await h.open({});
      assert.strictEqual(page.data.view, null);
      assert.strictEqual(page.data.loading, false);
      assert.strictEqual(page.data.isKeeper, true);
      assert.deepStrictEqual(page.data.scopeOptions.map((item) => item.key), ["all", "material", "device"]);
      assert.deepStrictEqual(h.callsTo("GET", `${BASE}?`).map((call) => call.path), [`${BASE}?status=counting&pageSize=1`]);

      await page.onStart(h.event({ scope: "all" }));
      assert.strictEqual(h.state.modals[0].title, "发起盘点？");
      assert.deepStrictEqual(h.callsTo("POST", BASE).map((call) => call.data), [{ scope: "all" }]);
      assert.strictEqual(page.data.view.header.no, "PD-20261112-0001");
      assert.strictEqual(page.data.view.canEdit, true);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "发起时点了取消：不发请求",
    async () => {
      const h = setup({ counting: false });
      const page = await h.open({});
      h.state.modalConfirm = false;
      await page.onStart(h.event({ scope: "material" }));
      assert.strictEqual(h.callsTo("POST", BASE).length, 0);
      assert.strictEqual(page.data.view, null);
    }
  ],
  [
    "发起时别人已经先发起了（409）：提示，并显示那一次",
    async () => {
      const h = setup({ counting: false });
      h.fail("POST", BASE, "已有进行中的盘点 PD-20261112-0001，先完成或取消它", 409);
      const page = await h.open({});
      h.respond("GET", `${BASE}?`, { success: true, data: [{ id: 5 }], pagination: { page: 1, pageSize: 1, total: 1 } });
      await page.onStart(h.event({ scope: "all" }));
      assert.ok(h.state.toasts.includes("已有进行中的盘点 PD-20261112-0001，先完成或取消它"));
      assert.strictEqual(page.data.view.header.no, "PD-20261112-0001");
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "不是库管：没有进行中的盘点时点发起没反应；有盘点时只读，点行不弹录数层",
    async () => {
      const none = setup({ keeper: false, counting: false });
      const empty = await none.open({});
      assert.strictEqual(empty.data.isKeeper, false);
      await empty.onStart(none.event({ scope: "all" }));
      assert.strictEqual(none.callsTo("POST", BASE).length, 0);

      const h = setup({ keeper: false });
      const page = await h.open({});
      assert.strictEqual(page.data.view.canEdit, false);
      assert.strictEqual(page.data.view.readOnlyNotice, "盘点由库管录入，这里只能看");
      page.openLine(h.event({ id: 11 }));
      assert.strictEqual(page.data.editing, null);
      await page.onComplete();
      await page.onCancel();
      await page.onScan();
      assert.strictEqual(posts(h, "/5/").length, 0);
    }
  ],
  [
    "录数：点行、输 8、保存 → PUT，列表那一行和页签上的数变了，录数层关掉",
    async () => {
      const h = setup();
      h.respond("PUT", `${BASE}/5/material-line/11`, ok(materialLine({ counted_qty: 8, book_qty: 10, diff: -2, note: "少两袋" })));
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      assert.deepStrictEqual(page.data.editing, {
        lineId: 11,
        title: "水泥 P.O42.5",
        bookText: "账面 10 袋",
        countText: "",
        note: "",
        counted: false
      });
      page.onCountInput(h.event({}, { value: "8" }));
      page.onNoteInput(h.event({}, { value: " 少两袋 " }));
      await page.saveLine();
      assert.deepStrictEqual(
        h.callsTo("PUT", `${BASE}/5/material-line/11`).map((call) => call.data),
        [{ counted_qty: 8, note: "少两袋" }]
      );
      assert.strictEqual(page.data.editing, null);
      assert.deepStrictEqual(page.data.view.tabs[0], { key: "material", label: "物资 1/2" });
      assert.strictEqual(page.data.view.materialRows[0].countText, "实盘 8");
      assert.strictEqual(page.data.view.materialRows[0].diffText, "-2");
      assert.ok(h.state.toasts.includes("已保存"));
      // 没有为了这一行把整页重新拉一遍
      assert.strictEqual(h.callsTo("GET", `${BASE}/5`).length, 1);
    }
  ],
  [
    "输 -1、输字母、什么都不输：不发请求，提示原因，录数层不关",
    async () => {
      const h = setup();
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      for (const [text, message] of [
        ["-1", "实盘数不能是负数"],
        ["abc", "请填数字"],
        ["", "先填实盘数"]
      ]) {
        page.onCountInput(h.event({}, { value: text }));
        await page.saveLine();
        assert.ok(h.state.toasts.includes(message), message);
      }
      assert.strictEqual(h.callsTo("PUT", BASE).length, 0);
      assert.notStrictEqual(page.data.editing, null);
    }
  ],
  [
    "保存失败：提示后端的中文，录数层不关，busy 复位；连点两次只发一次",
    async () => {
      const h = setup();
      h.failOnce("PUT", `${BASE}/5/material-line/11`, "服务器出错，请稍后重试", 500);
      h.respond("PUT", `${BASE}/5/material-line/11`, ok(materialLine({ counted_qty: 8, book_qty: 10, diff: -2 })));
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      page.onCountInput(h.event({}, { value: "8" }));
      await page.saveLine();
      assert.ok(h.state.toasts.includes("服务器出错，请稍后重试"));
      assert.notStrictEqual(page.data.editing, null);
      assert.strictEqual(page.data.busy, false);
      await Promise.all([page.saveLine(), page.saveLine()]);
      assert.strictEqual(h.callsTo("PUT", `${BASE}/5/material-line/11`).length, 2);
      assert.strictEqual(page.data.editing, null);
    }
  ],
  [
    "录过的行再点开带出原来的数和备注；点清掉发 counted_qty: null",
    async () => {
      const counted = materialLine({ counted_qty: 8, book_qty: 10, diff: -2, note: "少两袋" });
      const h = setup({ detail: detailOf({ material_counted: 1, material_diff: 1, material_lines: [counted] }) });
      h.respond("PUT", `${BASE}/5/material-line/11`, ok(materialLine()));
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      assert.strictEqual(page.data.editing.countText, "8");
      assert.strictEqual(page.data.editing.note, "少两袋");
      assert.strictEqual(page.data.editing.counted, true);
      await page.clearLine();
      assert.deepStrictEqual(h.callsTo("PUT", `${BASE}/5/material-line/11`)[0].data, { counted_qty: null, note: "" });
      assert.strictEqual(page.data.view.materialRows[0].countText, "没盘");
      assert.strictEqual(page.data.editing, null);
    }
  ],
  [
    "录过的行只改备注：只发 note，不带实盘数（带了会按现在的账面数重记，差额就变了）",
    async () => {
      const counted = materialLine({ counted_qty: 8, book_qty: 10, current_qty: 7, diff: -2 });
      const h = setup({ detail: detailOf({ material_counted: 1, material_diff: 1, material_lines: [counted] }) });
      h.respond("PUT", `${BASE}/5/material-line/11`, ok({ ...counted, note: "箱子破损" }));
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      // 录数层上写的是录的时候记下的账面数，不是「现在」的
      assert.strictEqual(page.data.editing.bookText, "录的时候账面 10 袋");
      page.onNoteInput(h.event({}, { value: "箱子破损" }));
      await page.saveLine();
      assert.deepStrictEqual(
        h.callsTo("PUT", `${BASE}/5/material-line/11`).map((call) => call.data),
        [{ note: "箱子破损" }]
      );
      assert.strictEqual(page.data.view.materialRows[0].diffText, "-2");
      assert.strictEqual(page.data.view.materialRows[0].note, "箱子破损");
      assert.strictEqual(page.data.editing, null);

      // 实盘数写法不同但数一样（8.0）：也算没改
      page.openLine(h.event({ id: 11 }));
      page.onCountInput(h.event({}, { value: "8.0" }));
      await page.saveLine();
      assert.deepStrictEqual(h.callsTo("PUT", `${BASE}/5/material-line/11`)[1].data, { note: "箱子破损" });
    }
  ],
  [
    "录过的行改了实盘数：实盘数和备注一起发（这时才重记账面数）",
    async () => {
      const counted = materialLine({ counted_qty: 8, book_qty: 10, diff: -2, note: "少两袋" });
      const h = setup({ detail: detailOf({ material_counted: 1, material_diff: 1, material_lines: [counted] }) });
      h.respond("PUT", `${BASE}/5/material-line/11`, ok(materialLine({ counted_qty: 9, book_qty: 10, diff: -1, note: "少两袋" })));
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      page.onCountInput(h.event({}, { value: "9" }));
      await page.saveLine();
      assert.deepStrictEqual(h.callsTo("PUT", `${BASE}/5/material-line/11`)[0].data, { counted_qty: 9, note: "少两袋" });
      assert.strictEqual(page.data.view.materialRows[0].diffText, "-1");
    }
  ],
  [
    "保存时盘点已经被别人结束（409）：提示，关掉录数层，重新拉",
    async () => {
      const h = setup();
      h.fail("PUT", `${BASE}/5/material-line/11`, "这次盘点已经结束，不能再改", 409);
      const page = await h.open({});
      page.openLine(h.event({ id: 11 }));
      page.onCountInput(h.event({}, { value: "8" }));
      h.respond("GET", `${BASE}?`, { success: true, data: [], pagination: { page: 1, pageSize: 1, total: 0 } });
      await page.saveLine();
      assert.ok(h.state.toasts.includes("这次盘点已经结束，不能再改"));
      assert.strictEqual(page.data.editing, null);
      assert.strictEqual(page.data.view, null);
    }
  ],
  [
    "页签、筛选、关键字都是本地的，不发请求",
    async () => {
      const h = setup();
      const page = await h.open({});
      const before = h.state.calls.length;
      page.onSearchInput(h.event({}, { value: "扳" }));
      assert.deepStrictEqual(page.data.view.materialRows.map((row) => row.id), [12]);
      page.onSearchInput(h.event({}, { value: "" }));
      page.onFilter(h.event({ key: "diff" }));
      assert.strictEqual(page.data.view.materialRows.length, 0);
      page.onTab(h.event({ key: "device" }));
      assert.strictEqual(page.data.view.activeTab, "device");
      assert.strictEqual(h.state.calls.length, before);
    }
  ],
  [
    "连续扫码：两台在库的都标记找到，第三台账上在项目 → 弹窗写着补返库单，点结束就停",
    async () => {
      const h = setup();
      h.respond("POST", `${BASE}/5/device-scan`, (call) => {
        const code = call.data.device_code;
        if (code === "SB-0004") {
          return ok({
            line: deviceLine({ id: 29, device_id: 4, device_code: "SB-0004", expected: 0, found: 1, location: "project", project_name: "临河 DN1200" }),
            unexpected: true,
            hint: "账上在「临河 DN1200」，盘完后补一张返库单"
          });
        }
        const line = code === "SB-0001" ? deviceLine({ found: 1 }) : deviceLine({ id: 22, device_id: 2, device_code: "SB-0002", found: 1 });
        return ok({ line, unexpected: false, hint: null });
      });
      const page = await h.open({});
      h.state.scans = ["HYBC:D:SB-0001", "hybc:d:SB-0002", "HYBC:D:SB-0004", "HYBC:D:SB-0001"];
      h.state.modalConfirm = false;
      await page.onScan();
      assert.deepStrictEqual(
        posts(h, "/5/device-scan").map((call) => call.data),
        [
          { device_code: "SB-0001", found: true },
          { device_code: "SB-0002", found: true },
          { device_code: "SB-0004", found: true }
        ]
      );
      assert.strictEqual(h.state.vibrations, 2);
      assert.strictEqual(h.state.modals.length, 1);
      assert.strictEqual(h.state.modals[0].title, "SB-0004 账上不在库");
      assert.strictEqual(h.state.modals[0].content, "账上在「临河 DN1200」，盘完后补一张返库单");
      assert.strictEqual(page.data.scanning, false);
      assert.deepStrictEqual(page.data.view.tabs[1], { key: "device", label: "设备 2/2" });
      assert.deepStrictEqual(page.data.view.deviceRows.map((row) => row.statusText), [
        "已找到",
        "已找到",
        "账上在项目"
      ]);
      assert.strictEqual(page.data.view.deviceRows[2].hint, "账上在「临河 DN1200」，记得补返库单");
      // 还剩一个没扫的码：点了结束就不再扫
      assert.strictEqual(h.state.scans.length, 1);
    }
  ],
  [
    "扫到不是设备码的、查不到的：弹窗停住，点继续扫接着扫；取消扫码就结束",
    async () => {
      const h = setup();
      h.respond("POST", `${BASE}/5/device-scan`, (call) => {
        if (call.data.device_code === "SB-9999") {
          const error = new Error("没有这台设备");
          error.__statusCode = 404;
          throw error;
        }
        return ok({ line: deviceLine({ found: 1 }), unexpected: false, hint: null });
      });
      const page = await h.open({});
      h.state.scans = ["https://example.com/x", "HYBC:D:SB-9999", "HYBC:D:SB-0001"];
      await page.onScan();
      assert.deepStrictEqual(h.state.modals.map((modal) => modal.title), ["不是设备码", "没有这台设备：SB-9999"]);
      assert.deepStrictEqual(
        posts(h, "/5/device-scan").map((call) => call.data.device_code),
        ["SB-9999", "SB-0001"]
      );
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "扫码时断网：提示后直接停下，不弹窗；相机打不开也一样",
    async () => {
      const h = setup();
      h.fail("POST", `${BASE}/5/device-scan`, "网络不给力，请稍后重试", 0);
      const page = await h.open({});
      h.state.scans = ["HYBC:D:SB-0001", "HYBC:D:SB-0002"];
      await page.onScan();
      assert.ok(h.state.toasts.includes("网络不给力，请稍后重试"));
      assert.strictEqual(h.state.modals.length, 0);
      assert.strictEqual(posts(h, "/5/device-scan").length, 1);

      h.state.scans = [{ errMsg: "scanCode:fail system permission denied" }];
      await page.onScan();
      assert.ok(h.state.toasts.includes("扫码失败，请重试"));
      assert.strictEqual(page.data.scanning, false);
    }
  ],
  [
    "手输编号：发 device_code；点了取消或没填不发",
    async () => {
      const h = setup();
      h.respond("POST", `${BASE}/5/device-scan`, ok({ line: deviceLine({ found: 1 }), unexpected: false, hint: null }));
      const page = await h.open({});
      h.state.modalInput = " sb-0001 ";
      await page.onInputCode();
      assert.deepStrictEqual(posts(h, "/5/device-scan").map((call) => call.data), [{ device_code: "sb-0001", found: true }]);
      assert.ok(h.state.toasts.includes("SB-0001 已找到"));
      h.state.modalInput = "";
      await page.onInputCode();
      h.state.modalConfirm = false;
      await page.onInputCode();
      assert.strictEqual(posts(h, "/5/device-scan").length, 1);
    }
  ],
  [
    "点一台设备：选「没找到」→ 填备注 → 发 found: false；选「清掉标记」发 found: null",
    async () => {
      const h = setup();
      h.respondOnce("POST", `${BASE}/5/device-scan`, ok({ line: deviceLine({ found: 0, note: "借给二队了" }), unexpected: false, hint: null }));
      h.respond("POST", `${BASE}/5/device-scan`, ok({ line: deviceLine(), unexpected: false, hint: null }));
      const page = await h.open({});
      // 没标记的行：找到了、没找到
      h.state.actionSheetIndex = 1;
      h.state.modalInput = "借给二队了";
      await page.onDeviceTap(h.event({ id: 1 }));
      assert.deepStrictEqual(posts(h, "/5/device-scan")[0].data, { device_id: 1, found: false, note: "借给二队了" });
      assert.strictEqual(page.data.view.deviceRows[0].statusText, "没找到");
      // 标了没找到的行：找到了、清掉标记
      await page.onDeviceTap(h.event({ id: 1 }));
      assert.deepStrictEqual(posts(h, "/5/device-scan")[1].data, { device_id: 1, found: null, note: "" });
      // 动作面板点了取消
      h.state.actionSheetIndex = -1;
      await page.onDeviceTap(h.event({ id: 2 }));
      assert.strictEqual(posts(h, "/5/device-scan").length, 2);
    }
  ],
  [
    "完成：先重新取一次，确认框里是汇总的句子；确认后带着最新的版本发 POST；成功后页面只读",
    async () => {
      const h = setup();
      const page = await h.open({});
      const fresh = detailOf({ version: 9, material_counted: 1, material_diff: 1 });
      h.respond("GET", `${BASE}/5`, ok(fresh));
      h.respond(
        "POST",
        `${BASE}/5/complete`,
        ok({
          stocktake: { ...fresh, status: "done", adjust_doc_no: "KFD-20261112-0001" },
          adjust_doc: { id: 3, doc_no: "KFD-20261112-0001" },
          replayed: false
        })
      );
      await page.onComplete();
      assert.strictEqual(h.state.modals[0].title, "完成盘点？");
      assert.strictEqual(
        h.state.modals[0].content,
        [
          "1 条物资有差额，会出一张盘点调整单",
          "还有 1 条物资没盘，这些不动",
          "2 台在库设备没找到，会在时间线上记「盘点未找到」",
          "完成之后不能再改。"
        ].join("\n")
      );
      assert.deepStrictEqual(posts(h, "/5/complete").map((call) => call.data), [{ version: 9 }]);
      assert.strictEqual(page.data.view.canEdit, false);
      assert.strictEqual(page.data.view.header.statusLabel, "已完成");
      assert.deepStrictEqual(h.state.modals[1], { title: "盘点已完成", content: "调整单 KFD-20261112-0001" });
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "完成时点了再看看：不发请求",
    async () => {
      const h = setup();
      const page = await h.open({});
      h.state.modalConfirm = false;
      await page.onComplete();
      assert.strictEqual(posts(h, "/5/complete").length, 0);
      assert.strictEqual(page.data.busy, false);
      assert.strictEqual(page.data.view.canEdit, true);
    }
  ],
  [
    "完成返回 409：提示并重新拉详情",
    async () => {
      const h = setup();
      h.fail("POST", `${BASE}/5/complete`, "数据已变化，请刷新后重试", 409);
      const page = await h.open({});
      await page.onComplete();
      assert.ok(h.state.toasts.includes("数据已变化，请刷新后重试"));
      // 打开一次、完成前一次、409 之后一次
      assert.strictEqual(h.callsTo("GET", `${BASE}/5`).length, 3);
      assert.strictEqual(page.data.view.canEdit, true);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "取消盘点：填原因后发 POST，回到可以发起的样子；弹窗点取消不发",
    async () => {
      const h = setup();
      h.respond("POST", `${BASE}/5/cancel`, ok(detailOf({ status: "cancelled" })));
      const page = await h.open({});
      h.state.modalConfirm = false;
      await page.onCancel();
      assert.strictEqual(posts(h, "/5/cancel").length, 0);
      h.state.modalConfirm = true;
      h.state.modalInput = " 点错了 ";
      h.respond("GET", `${BASE}?`, { success: true, data: [], pagination: { page: 1, pageSize: 1, total: 0 } });
      await page.onCancel();
      assert.deepStrictEqual(posts(h, "/5/cancel").map((call) => call.data), [{ reason: "点错了" }]);
      assert.ok(h.state.toasts.includes("盘点已取消"));
      assert.strictEqual(page.data.view, null);
      assert.strictEqual(page.data.busy, false);
    }
  ],
  [
    "离开页面后回来的详情请求不再 setData",
    async () => {
      const h = setup();
      const page = await h.open({});
      h.respond(
        "GET",
        `${BASE}/5`,
        () => new Promise((resolve) => setTimeout(() => resolve(ok(detailOf({ stocktake_no: "PD-LATE" }))), 20))
      );
      const pending = page.onPullDownRefresh();
      page.onUnload();
      await pending;
      assert.strictEqual(page.data.view.header.no, "PD-20261112-0001");
    }
  ],
  [
    "带 id 打开已完成的盘点：只读，不去找进行中的那一次",
    async () => {
      const done = detailOf({ id: 7, status: "done", adjust_doc_no: "KFD-20261112-0003" });
      const h = setup({ detail: done });
      const page = await h.open({ id: "7" });
      assert.strictEqual(h.callsTo("GET", `${BASE}?`).length, 0);
      assert.strictEqual(page.data.view.canEdit, false);
      assert.strictEqual(page.data.view.header.adjustText, "调整单 KFD-20261112-0003");
      page.openLine(h.event({ id: 11 }));
      assert.strictEqual(page.data.editing, null);
    }
  ],
  [
    "加载失败：提示，下拉重试能恢复",
    async () => {
      const h = setup();
      h.failOnce("GET", `${BASE}/5`, "网络不给力，请稍后重试", 0);
      const page = await h.open({});
      assert.strictEqual(page.data.loadFailed, true);
      assert.strictEqual(page.data.loading, false);
      assert.ok(h.state.toasts.includes("网络不给力，请稍后重试"));
      await page.onPullDownRefresh();
      assert.strictEqual(page.data.loadFailed, false);
      assert.strictEqual(page.data.view.header.no, "PD-20261112-0001");
      assert.strictEqual(h.state.pullStops, 1);
    }
  ]
]);
