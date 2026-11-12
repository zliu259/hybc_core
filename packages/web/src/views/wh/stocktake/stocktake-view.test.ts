import { describe, expect, it } from "vitest";

import type {
  StocktakeDetail,
  StocktakeDeviceLineRow,
  StocktakeMaterialLineRow
} from "@/api/wh/stocktake-types";
import {
  applyDeviceLine,
  applyMaterialLine,
  completeSummary,
  deviceLineStatus,
  diffText,
  filterMaterialLines,
  materialCategories,
  parseCount,
  progressText
} from "./stocktake-view";

const NOW = "2026-11-12T00:00:00.000Z";

const materialLine = (
  patch: Partial<StocktakeMaterialLineRow> = {}
): StocktakeMaterialLineRow => ({
  id: 1,
  stocktake_id: 1,
  material_id: 1,
  counted_qty: null,
  book_qty: null,
  note: null,
  counted_by_userid: null,
  counted_at: null,
  created_at: NOW,
  updated_at: NOW,
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

const deviceLine = (
  patch: Partial<StocktakeDeviceLineRow> = {}
): StocktakeDeviceLineRow => ({
  id: 1,
  stocktake_id: 1,
  device_id: 1,
  expected: 1,
  found: null,
  note: null,
  scanned_by_userid: null,
  scanned_at: null,
  created_at: NOW,
  updated_at: NOW,
  device_code: "SB-0001",
  device_name: "顶管机",
  alias: null,
  category_name: "顶管机",
  storage_note: null,
  location: "warehouse",
  project_name: null,
  ...patch
});

const detail = (patch: Partial<StocktakeDetail> = {}): StocktakeDetail => ({
  id: 1,
  stocktake_no: "PD-20261112-0001",
  scope: "all",
  status: "counting",
  remark: null,
  cancel_reason: null,
  created_by_userid: "kp",
  completed_by_userid: null,
  completed_at: null,
  cancelled_by_userid: null,
  cancelled_at: null,
  version: 1,
  created_at: NOW,
  updated_at: NOW,
  material_total: 0,
  material_counted: 0,
  material_diff: 0,
  device_expected: 0,
  device_found: 0,
  device_missing: 0,
  device_unexpected: 0,
  adjust_doc_id: null,
  adjust_doc_no: null,
  material_lines: [],
  device_lines: [],
  ...patch
});

describe("stocktake-view", () => {
  it("筛没盘的、有差额的；关键字搜品名、规格、编号，不分大小写", () => {
    const lines = [
      materialLine({
        id: 1,
        name: "水泥",
        spec: "P.O42.5",
        material_code: "WZ-0001"
      }),
      materialLine({
        id: 2,
        name: "扳手",
        spec: "",
        material_code: "WZ-0002",
        counted_qty: 3,
        book_qty: 3,
        diff: 0
      }),
      materialLine({
        id: 3,
        name: "钢管",
        spec: "Φ114",
        material_code: "wz-0003",
        counted_qty: 1,
        book_qty: 3,
        diff: -2
      })
    ];
    const ids = (result: StocktakeMaterialLineRow[]) =>
      result.map(line => line.id);
    expect(ids(filterMaterialLines(lines, "all", ""))).toEqual([1, 2, 3]);
    expect(ids(filterMaterialLines(lines, "uncounted", ""))).toEqual([1]);
    expect(ids(filterMaterialLines(lines, "diff", ""))).toEqual([3]);
    expect(ids(filterMaterialLines(lines, "all", " p.o42 "))).toEqual([1]);
    expect(ids(filterMaterialLines(lines, "all", "WZ-0003"))).toEqual([3]);
    expect(ids(filterMaterialLines(lines, "all", "扳"))).toEqual([2]);
    expect(ids(filterMaterialLines(lines, "diff", "水泥"))).toEqual([]);
  });

  it("按类别筛；类别清单按出现顺序去重", () => {
    const lines = [
      materialLine({ id: 1, category: "工具" }),
      materialLine({ id: 2, category: "劳动保护" }),
      materialLine({ id: 3, category: "工具" })
    ];
    expect(materialCategories(lines)).toEqual(["工具", "劳动保护"]);
    expect(
      filterMaterialLines(lines, "all", "", "工具").map(line => line.id)
    ).toEqual([1, 3]);
  });

  it("diffText：+0.5、-2、一致、没录是空", () => {
    expect([0.5, -2, 0, null].map(diff => diffText({ diff }))).toEqual([
      "+0.5",
      "-2",
      "一致",
      ""
    ]);
  });

  it("parseCount：空串是 null；0 可以；负数、4 位小数、字母报错", () => {
    expect(parseCount("")).toEqual({ value: null });
    expect(parseCount("  ")).toEqual({ value: null });
    expect(parseCount("0")).toEqual({ value: 0 });
    expect(parseCount(" 12.125 ")).toEqual({ value: 12.125 });
    expect(parseCount("-1")).toEqual({ error: "实盘数不能是负数" });
    expect(parseCount("1.2345")).toEqual({ error: "最多 3 位小数" });
    expect(parseCount("1e3")).toEqual({ error: "请填数字" });
    expect(parseCount("abc")).toEqual({ error: "请填数字" });
    expect(parseCount("1000001")).toEqual({ error: "数字太大了" });
  });

  it("deviceLineStatus 的几种情况", () => {
    expect(deviceLineStatus(deviceLine({ found: 1 }), "counting")).toEqual({
      text: "已找到",
      type: "success"
    });
    expect(deviceLineStatus(deviceLine({ found: 0 }), "counting")).toEqual({
      text: "没找到",
      type: "danger"
    });
    expect(deviceLineStatus(deviceLine(), "counting")).toEqual({
      text: "没扫到",
      type: "info"
    });
    expect(
      deviceLineStatus(
        deviceLine({
          expected: 0,
          found: 1,
          location: "project",
          project_name: "临河 DN1200"
        }),
        "counting"
      )
    ).toEqual({ text: "账上在「临河 DN1200」", type: "warning" });
    expect(
      deviceLineStatus(
        deviceLine({ expected: 0, found: 1, location: "scrapped" }),
        "counting"
      )
    ).toEqual({ text: "账上已报废", type: "warning" });
    // 发起之后才入库的：扫到了就是找到
    expect(
      deviceLineStatus(deviceLine({ expected: 0, found: 1 }), "counting")
    ).toEqual({
      text: "已找到",
      type: "success"
    });
    // 已完成的盘点里还空着的，是盘点期间已经出库的
    expect(
      deviceLineStatus(deviceLine({ location: "project" }), "done")
    ).toEqual({
      text: "盘点期间已出库",
      type: "info"
    });
  });

  it("completeSummary：有差额、没盘完、设备没找到、账上不在库各一句", () => {
    expect(
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
      )
    ).toEqual([
      "2 条物资有差额，会出一张盘点调整单",
      "还有 4 条物资没盘，这些不动",
      "2 台在库设备没找到，会在时间线上记「盘点未找到」",
      "1 台扫到了但账上不在库，记得补返库单"
    ]);
  });

  it("completeSummary：都对得上时说一致；只盘设备时不提物资", () => {
    expect(
      completeSummary(
        detail({ material_total: 3, material_counted: 3, material_diff: 0 })
      )
    ).toEqual(["账面和实盘一致，不出调整单"]);
    expect(
      completeSummary(
        detail({ scope: "device", device_expected: 2, device_found: 2 })
      )
    ).toEqual(["设备都找到了"]);
  });

  it("completeSummary：只盘了一部分而且都对得上，也要说还有几条没盘", () => {
    expect(
      completeSummary(
        detail({ material_total: 10, material_counted: 3, material_diff: 0 })
      )
    ).toEqual(["账面和实盘一致，不出调整单", "还有 7 条物资没盘，这些不动"]);
    expect(
      completeSummary(
        detail({
          material_total: 10,
          device_expected: 2,
          device_found: 1,
          device_missing: 1
        })
      )
    ).toEqual([
      "还有 10 条物资没盘，这些不动",
      "1 台在库设备没找到，会在时间线上记「盘点未找到」"
    ]);
  });

  it("progressText：已盘几条、找到几台；没有的那一半是横线", () => {
    expect(
      progressText(
        detail({ material_total: 10, material_counted: 6 }),
        "material"
      )
    ).toBe("6 / 10");
    expect(
      progressText(detail({ device_expected: 5, device_found: 3 }), "device")
    ).toBe("3 / 5");
    expect(progressText(detail(), "material")).toBe("-");
  });

  it("applyMaterialLine：换掉那一行并更新已盘数、差额数，原对象不变", () => {
    const before = detail({
      material_total: 2,
      material_lines: [materialLine({ id: 1 }), materialLine({ id: 2 })]
    });
    const after = applyMaterialLine(
      before,
      materialLine({ id: 2, counted_qty: 8, book_qty: 10, diff: -2 })
    );
    expect(after).toMatchObject({ material_counted: 1, material_diff: 1 });
    expect(after.material_lines[1].counted_qty).toBe(8);
    expect(before.material_lines[1].counted_qty).toBeNull();
    expect(before.material_counted).toBe(0);
    const cleared = applyMaterialLine(after, materialLine({ id: 2 }));
    expect(cleared).toMatchObject({ material_counted: 0, material_diff: 0 });
  });

  it("applyDeviceLine：换掉或加上那一行，重算找到、没找到、不在库的台数", () => {
    const before = detail({
      device_expected: 2,
      device_missing: 2,
      device_lines: [
        deviceLine({ id: 1, device_id: 1 }),
        deviceLine({ id: 2, device_id: 2 })
      ]
    });
    const found = applyDeviceLine(
      before,
      deviceLine({ id: 1, device_id: 1, found: 1 })
    );
    expect(found).toMatchObject({
      device_expected: 2,
      device_found: 1,
      device_missing: 1
    });
    const unexpected = applyDeviceLine(
      found,
      deviceLine({
        id: 9,
        device_id: 9,
        device_code: "SB-0009",
        expected: 0,
        found: 1,
        location: "project"
      })
    );
    expect(unexpected.device_lines.map(line => line.device_code)).toEqual([
      "SB-0001",
      "SB-0001",
      "SB-0009"
    ]);
    expect(unexpected).toMatchObject({
      device_unexpected: 1,
      device_found: 1,
      device_missing: 1
    });
    expect(before.device_lines).toHaveLength(2);
  });
});
