import { describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite, readMigration } from "./helpers/sqlite-d1";

// 迁移 0100：设备类别的编号开头。

describe.skipIf(!hasSqlite)("0100 设备类别的编号开头", () => {
  it("device_category 多了 code_prefix，默认是空的；两个类别不能用同一个开头，空的不算", () => {
    const h = createWarehouseHarness();
    const a = h.seed.category("甲");
    const b = h.seed.category("乙");
    const c = h.seed.category("丙");
    const set = (id, prefix) =>
      h.database.prepare("UPDATE device_category SET code_prefix = ? WHERE id = ?").run(prefix, id);
    expect(
      h.database.prepare("SELECT code_prefix FROM device_category WHERE id = ?").get(a)
    ).toEqual({
      code_prefix: null
    });
    set(a, "DG");
    expect(() => set(b, "DG")).toThrow(/UNIQUE/);
    set(b, null);
    set(c, null);
  });

  it("迁移给现有的五个类别按名字补上开头，已经有开头的不动，别的类别不动", () => {
    const h = createWarehouseHarness();
    const ids = Object.fromEntries(
      ["顶管机", "油泵站", "发电机", "泥水分离器", "顶铁", "水泵"].map((name) => [
        name,
        h.seed.category(name)
      ])
    );
    h.database
      .prepare("UPDATE device_category SET code_prefix = 'JT' WHERE id = ?")
      .run(ids["顶铁"]);
    // 只重跑迁移里补数据的那几句
    const updates = readMigration("0100_device_category_code_prefix.sql")
      .split(";")
      .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
      .filter((statement) => statement.toUpperCase().startsWith("UPDATE"));
    expect(updates).toHaveLength(5);
    for (const statement of updates) h.database.exec(statement);
    const rows = h.database
      .prepare("SELECT name, code_prefix FROM device_category ORDER BY id")
      .all();
    expect(Object.fromEntries(rows.map((row) => [row.name, row.code_prefix]))).toEqual({
      顶管机: "DG",
      油泵站: "YB",
      发电机: "FD",
      泥水分离器: "FL",
      顶铁: "JT",
      水泵: null
    });
  });
});
