import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 迁移 0098：盘点三张表。「同一时间只能有一个进行中的盘点」写在数据库里，代码绕不过去。

const NOW = "2026-11-12T00:00:00.000Z";

describe.skipIf(!hasSqlite)("0098 盘点表", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  const insertInto = (table, row) => {
    const columns = Object.keys(row);
    const info = h.database
      .prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column]));
    return Number(info.lastInsertRowid);
  };

  const insert = (patch = {}) =>
    insertInto("stocktake", {
      stocktake_no: `PD-${Math.random().toString(16).slice(2)}`,
      scope: "all",
      status: "counting",
      created_by_userid: "kp",
      created_at: NOW,
      updated_at: NOW,
      ...patch
    });

  const insertLine = (patch = {}) =>
    insertInto("stocktake_material_line", {
      stocktake_id: 1,
      material_id: 1,
      created_at: NOW,
      updated_at: NOW,
      ...patch
    });

  const insertDeviceLine = (patch = {}) =>
    insertInto("stocktake_device_line", {
      stocktake_id: 1,
      device_id: 1,
      expected: 1,
      created_at: NOW,
      updated_at: NOW,
      ...patch
    });

  it("三张表和两个索引都在", () => {
    const names = h.database
      .prepare("SELECT name FROM sqlite_master")
      .all()
      .map((row) => row.name);
    for (const name of [
      "stocktake",
      "stocktake_material_line",
      "stocktake_device_line",
      "idx_stocktake_single_counting",
      "idx_wh_doc_stocktake_id"
    ]) {
      expect(names).toContain(name);
    }
  });

  it("第二个进行中的盘点插不进去，已完成的可以有很多个", () => {
    insert({ stocktake_no: "PD-1", status: "counting" });
    expect(() => insert({ stocktake_no: "PD-2", status: "counting" })).toThrow(/UNIQUE/);
    insert({ stocktake_no: "PD-3", status: "done" });
    insert({ stocktake_no: "PD-4", status: "done" });
    insert({ stocktake_no: "PD-5", status: "cancelled" });
    insert({ stocktake_no: "PD-6", status: "cancelled" });
  });

  it("单号不能重复；范围和状态只认定好的值；新盘点的版本是 1", () => {
    const id = insert({ stocktake_no: "PD-1", status: "done" });
    expect(() => insert({ stocktake_no: "PD-1", status: "done" })).toThrow(/UNIQUE/);
    expect(() => insert({ scope: "everything", status: "done" })).toThrow(/CHECK/);
    expect(() => insert({ status: "paused" })).toThrow(/CHECK/);
    expect(h.database.prepare("SELECT version FROM stocktake WHERE id = ?").get(id).version).toBe(
      1
    );
  });

  it("实盘数和账面数要么都有要么都没有；实盘数不能是负数", () => {
    expect(() => insertLine({ counted_qty: 3, book_qty: null })).toThrow(/CHECK/);
    expect(() => insertLine({ counted_qty: null, book_qty: 3 })).toThrow(/CHECK/);
    expect(() => insertLine({ counted_qty: -1, book_qty: 2 })).toThrow(/CHECK/);
    insertLine({ material_id: 2, counted_qty: 0, book_qty: 2 });
    insertLine({ material_id: 3 });
  });

  it("同一次盘点里一条物资、一台设备各只有一行", () => {
    insertLine({ material_id: 7 });
    expect(() => insertLine({ material_id: 7 })).toThrow(/UNIQUE/);
    insertLine({ stocktake_id: 2, material_id: 7 });
    insertDeviceLine({ device_id: 9 });
    expect(() => insertDeviceLine({ device_id: 9 })).toThrow(/UNIQUE/);
    insertDeviceLine({ stocktake_id: 2, device_id: 9 });
  });

  it("设备行的 expected 只能是 0 或 1，found 只能是空、0、1", () => {
    expect(() => insertDeviceLine({ expected: 2 })).toThrow(/CHECK/);
    expect(() => insertDeviceLine({ device_id: 2, found: 2 })).toThrow(/CHECK/);
    insertDeviceLine({ device_id: 3, expected: 0, found: 1 });
    insertDeviceLine({ device_id: 4, found: 0 });
  });

  it("旧的盘点表没被这次迁移动过", () => {
    const names = h.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(names).toContain("stocktake_task");
    expect(names).toContain("stocktake_line");
  });
});
