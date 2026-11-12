/** 盘点页的视图模型。运行：node packageWarehouse/common/wh-stocktake-view.test.js */
const assert = require("assert");

const {
  MAX_MATERIAL_ROWS,
  SCOPE_OPTIONS,
  buildStocktakeView,
  completeSummary,
  deviceActions,
  parseCount,
  withDeviceLine,
  withMaterialLine
} = require("./wh-stocktake-view");

const materialLine = (patch = {}) => ({
  id: 1,
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
  id: 1,
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

const detail = (patch = {}) => ({
  id: 5,
  stocktake_no: "PD-20261112-0001",
  scope: "all",
  status: "counting",
  remark: null,
  version: 3,
  material_total: 0,
  material_counted: 0,
  material_diff: 0,
  device_expected: 0,
  device_found: 0,
  device_missing: 0,
  device_unexpected: 0,
  adjust_doc_no: null,
  material_lines: [],
  device_lines: [],
  ...patch
});

const options = (patch = {}) => ({ isKeeper: true, filter: "all", keyword: "", tab: "material", ...patch });

// ── 发起时的三个范围 ──
assert.deepStrictEqual(
  SCOPE_OPTIONS.map((item) => [item.key, item.label]),
  [
    ["all", "物资和设备都盘"],
    ["material", "只盘物资"],
    ["device", "只盘设备"]
  ]
);

// ── parseCount：和 Web 一样的规则 ──
assert.deepStrictEqual(parseCount(""), { value: null });
assert.deepStrictEqual(parseCount("  "), { value: null });
assert.deepStrictEqual(parseCount("0"), { value: 0 });
assert.deepStrictEqual(parseCount(" 12.125 "), { value: 12.125 });
assert.deepStrictEqual(parseCount("-1"), { error: "实盘数不能是负数" });
assert.deepStrictEqual(parseCount("1.2345"), { error: "最多 3 位小数" });
assert.deepStrictEqual(parseCount("1e3"), { error: "请填数字" });
assert.deepStrictEqual(parseCount("abc"), { error: "请填数字" });
assert.deepStrictEqual(parseCount("1000001"), { error: "数字太大了" });
assert.deepStrictEqual(parseCount(undefined), { value: null });

// ── completeSummary ──
assert.deepStrictEqual(
  completeSummary(
    detail({
      material_total: 10,
      material_counted: 6,
      material_diff: 2,
      device_expected: 5,
      device_found: 3,
      device_missing: 2,
      device_unexpected: 1
    })
  ),
  [
    "2 条物资有差额，会出一张盘点调整单",
    "还有 4 条物资没盘，这些不动",
    "2 台在库设备没找到，会在时间线上记「盘点未找到」",
    "1 台扫到了但账上不在库，记得补返库单"
  ]
);
assert.deepStrictEqual(completeSummary(detail({ material_total: 3, material_counted: 3 })), [
  "账面和实盘一致，不出调整单"
]);
assert.deepStrictEqual(completeSummary(detail({ material_total: 10, material_counted: 3 })), [
  "账面和实盘一致，不出调整单",
  "还有 7 条物资没盘，这些不动"
]);
assert.deepStrictEqual(completeSummary(detail({ scope: "device", device_expected: 2, device_found: 2 })), [
  "设备都找到了"
]);
// 一台设备都没标记：说明这次不记设备，不说都找到了
assert.deepStrictEqual(completeSummary(detail({ material_total: 3, material_counted: 3, device_expected: 2 })), [
  "账面和实盘一致，不出调整单",
  "设备一台都没标记，这次不记设备的盘点结果"
]);

// ── 库管 + 盘点中：能改；别人或已结束：只读 ──
{
  const counting = detail({
    material_total: 2,
    material_counted: 1,
    material_diff: 1,
    device_expected: 2,
    device_found: 1,
    device_missing: 1,
    material_lines: [
      materialLine({ id: 1 }),
      materialLine({ id: 2, name: "扳手", spec: "", unit: "把", counted_qty: 1, book_qty: 3, diff: -2, note: "少两把", storage_note: "A 区" })
    ],
    device_lines: [deviceLine({ id: 1 }), deviceLine({ id: 2, device_id: 2, device_code: "SB-0002", found: 1 })]
  });
  const view = buildStocktakeView(counting, options());
  assert.strictEqual(view.canEdit, true);
  assert.strictEqual(view.readOnlyNotice, "");
  assert.deepStrictEqual(view.header, {
    no: "PD-20261112-0001",
    scopeLabel: "全部",
    statusLabel: "盘点中",
    statusTheme: "primary",
    adjustText: ""
  });
  assert.deepStrictEqual(view.tabs, [
    { key: "material", label: "物资 1/2" },
    { key: "device", label: "设备 1/2" }
  ]);
  assert.strictEqual(view.activeTab, "material");
  assert.deepStrictEqual(view.materialRows, [
    { id: 1, title: "水泥 P.O42.5", sub: "WZ-0001", bookText: "账面 10 袋", countText: "没盘", counted: false, diffText: "", diffClass: "", note: "" },
    { id: 2, title: "扳手", sub: "WZ-0001 · A 区", bookText: "账面 3 把", countText: "实盘 1", counted: true, diffText: "-2", diffClass: "stocktake-loss", note: "少两把" }
  ]);
  assert.strictEqual(view.materialCount, 2);
  assert.strictEqual(view.materialMore, 0);
  assert.deepStrictEqual(
    view.deviceRows.map((row) => [row.deviceId, row.code, row.statusText, row.statusTheme]),
    [
      [1, "SB-0001", "没扫到", "default"],
      [2, "SB-0002", "已找到", "success"]
    ]
  );
  assert.deepStrictEqual(view.summaryLines, completeSummary(counting));

  const viewer = buildStocktakeView(counting, options({ isKeeper: false }));
  assert.strictEqual(viewer.canEdit, false);
  assert.strictEqual(viewer.readOnlyNotice, "盘点由库管录入，这里只能看");

  const done = buildStocktakeView(
    { ...counting, status: "done", adjust_doc_no: "KFD-20261112-0001" },
    options()
  );
  assert.strictEqual(done.canEdit, false);
  assert.strictEqual(done.readOnlyNotice, "");
  assert.strictEqual(done.header.statusLabel, "已完成");
  assert.strictEqual(done.header.statusTheme, "success");
  assert.strictEqual(done.header.adjustText, "调整单 KFD-20261112-0001");
  // 已完成的盘点里还空着的设备：盘点期间出库了，或者这次没盘设备，都叫「没标记」
  assert.strictEqual(done.deviceRows[0].statusText, "没标记");

  const cancelled = buildStocktakeView({ ...counting, status: "cancelled" }, options());
  assert.strictEqual(cancelled.header.statusLabel, "已取消");
  assert.strictEqual(cancelled.header.statusTheme, "default");
  const noDiff = buildStocktakeView({ ...counting, status: "done" }, options());
  assert.strictEqual(noDiff.header.adjustText, "没有差额，没出调整单");
}

// ── 范围只有一种时只有一个页签，而且就停在那一个 ──
{
  const materialOnly = buildStocktakeView(detail({ scope: "material", material_total: 4 }), options({ tab: "device" }));
  assert.deepStrictEqual(materialOnly.tabs, [{ key: "material", label: "物资 0/4" }]);
  assert.strictEqual(materialOnly.activeTab, "material");
  const deviceOnly = buildStocktakeView(detail({ scope: "device", device_expected: 3 }), options());
  assert.deepStrictEqual(deviceOnly.tabs, [{ key: "device", label: "设备 0/3" }]);
  assert.strictEqual(deviceOnly.activeTab, "device");
}

// ── 筛选和关键字；太多时只出前面一截 ──
{
  const lines = [
    materialLine({ id: 1, name: "水泥", spec: "P.O42.5", material_code: "WZ-0001" }),
    materialLine({ id: 2, name: "扳手", spec: "", material_code: "WZ-0002", counted_qty: 3, book_qty: 3, diff: 0 }),
    materialLine({ id: 3, name: "钢管", spec: "Φ114", material_code: "wz-0003", counted_qty: 1, book_qty: 3, diff: -2 })
  ];
  const ids = (patch) =>
    buildStocktakeView(detail({ material_lines: lines }), options(patch)).materialRows.map((row) => row.id);
  assert.deepStrictEqual(ids({}), [1, 2, 3]);
  assert.deepStrictEqual(ids({ filter: "uncounted" }), [1]);
  assert.deepStrictEqual(ids({ filter: "diff" }), [3]);
  assert.deepStrictEqual(ids({ keyword: " p.o42 " }), [1]);
  assert.deepStrictEqual(ids({ keyword: "WZ-0003" }), [3]);
  assert.deepStrictEqual(ids({ filter: "diff", keyword: "水泥" }), []);
  const same = buildStocktakeView(detail({ material_lines: lines }), options()).materialRows[1];
  assert.strictEqual(same.diffText, "一致");
  assert.strictEqual(same.diffClass, "");

  const many = Array.from({ length: MAX_MATERIAL_ROWS + 25 }, (_, index) => materialLine({ id: index + 1 }));
  const view = buildStocktakeView(detail({ material_lines: many }), options());
  assert.strictEqual(view.materialRows.length, MAX_MATERIAL_ROWS);
  assert.strictEqual(view.materialCount, MAX_MATERIAL_ROWS + 25);
  assert.strictEqual(view.materialMore, 25);
}

// ── 盘盈是绿的 ──
{
  const view = buildStocktakeView(
    detail({ material_lines: [materialLine({ counted_qty: 10.5, book_qty: 10, diff: 0.5 })] }),
    options()
  );
  assert.strictEqual(view.materialRows[0].diffText, "+0.5");
  assert.strictEqual(view.materialRows[0].diffClass, "stocktake-gain");
}

// ── 设备行的几种状态 ──
{
  const rows = buildStocktakeView(
    detail({
      device_lines: [
        deviceLine({ id: 1, device_id: 1, found: 0, note: "借给二队了", alias: "DN1200-1" }),
        deviceLine({ id: 2, device_id: 2, device_code: "SB-0002", expected: 0, found: 1, location: "project", project_name: "临河 DN1200" }),
        deviceLine({ id: 3, device_id: 3, device_code: "SB-0003", expected: 0, found: 1, location: "scrapped" }),
        deviceLine({ id: 4, device_id: 4, device_code: "SB-0004", expected: 0, found: 1 })
      ]
    }),
    options({ tab: "device" })
  ).deviceRows;
  assert.deepStrictEqual(
    rows.map((row) => [row.statusText, row.statusTheme]),
    [
      ["没找到", "danger"],
      ["账上在项目", "warning"],
      ["账上已报废", "warning"],
      ["已找到", "success"]
    ]
  );
  // 项目名可能很长，不放在右边的小标签里，单独一行
  assert.deepStrictEqual(
    rows.map((row) => row.hint),
    ["", "账上在「临河 DN1200」，记得补返库单", "", ""]
  );
  assert.strictEqual(rows[0].name, "顶管机（DN1200-1）");
  assert.strictEqual(rows[0].note, "借给二队了");
}

// ── 点一台设备能做什么 ──
assert.deepStrictEqual(deviceActions(deviceLine()), [
  { key: "found", label: "找到了" },
  { key: "missing", label: "没找到" }
]);
assert.deepStrictEqual(deviceActions(deviceLine({ found: 1 })), [
  { key: "missing", label: "没找到" },
  { key: "clear", label: "清掉标记" }
]);
assert.deepStrictEqual(deviceActions(deviceLine({ found: 0 })), [
  { key: "found", label: "找到了" },
  { key: "clear", label: "清掉标记" }
]);
// 账上不在库的只能清掉
assert.deepStrictEqual(deviceActions(deviceLine({ expected: 0, found: 1 })), [{ key: "clear", label: "清掉标记" }]);
assert.deepStrictEqual(deviceActions(null), []);

// ── 录完一行：换掉那一行并更新已盘数、差额数，原对象不变 ──
{
  const before = detail({ material_total: 2, material_lines: [materialLine({ id: 1 }), materialLine({ id: 2 })] });
  const after = withMaterialLine(before, materialLine({ id: 2, counted_qty: 8, book_qty: 10, diff: -2 }));
  assert.strictEqual(after.material_counted, 1);
  assert.strictEqual(after.material_diff, 1);
  assert.strictEqual(after.material_lines[1].counted_qty, 8);
  assert.strictEqual(before.material_lines[1].counted_qty, null);
  assert.strictEqual(before.material_counted, 0);
  const cleared = withMaterialLine(after, materialLine({ id: 2 }));
  assert.strictEqual(cleared.material_counted, 0);
  assert.strictEqual(cleared.material_diff, 0);
}

// ── 标记一台设备：换掉或加上那一行，重算台数 ──
{
  const before = detail({
    device_expected: 2,
    device_missing: 2,
    device_lines: [deviceLine({ id: 1, device_id: 1 }), deviceLine({ id: 2, device_id: 2, device_code: "SB-0002" })]
  });
  const found = withDeviceLine(before, deviceLine({ id: 1, device_id: 1, found: 1 }));
  assert.deepStrictEqual(
    [found.device_expected, found.device_found, found.device_missing, found.device_unexpected],
    [2, 1, 1, 0]
  );
  const unexpected = withDeviceLine(
    found,
    deviceLine({ id: 9, device_id: 9, device_code: "SB-0001A", expected: 0, found: 1, location: "project" })
  );
  assert.deepStrictEqual(
    unexpected.device_lines.map((line) => line.device_code),
    ["SB-0001", "SB-0001A", "SB-0002"]
  );
  assert.strictEqual(unexpected.device_unexpected, 1);
  assert.strictEqual(before.device_lines.length, 2);
  // 把唯一的标记清掉：一台都没标记，「会被记成没找到」的台数回到 0
  const cleared = withDeviceLine(found, deviceLine({ id: 1, device_id: 1, found: null }));
  assert.deepStrictEqual([cleared.device_found, cleared.device_missing], [0, 0]);
}

// ── 没有盘点时 ──
assert.strictEqual(buildStocktakeView(null, options()), null);

console.log("wh-stocktake-view: ok");
