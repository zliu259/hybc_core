import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 迁移 0096：配套清单四张表的约束写在数据库里，代码绕不过去。

const NOW = "2026-11-11T00:00:00.000Z";

describe.skipIf(!hasSqlite)("配套清单表结构", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  const insertTemplateLine = (templateId, patch = {}) => {
    const row = {
      template_id: templateId,
      section: "顶进设备",
      sort_order: 0,
      line_kind: "material",
      device_category_id: null,
      name_text: "排泥钢管",
      default_qty: 1,
      created_at: NOW,
      ...patch
    };
    const columns = Object.keys(row);
    return h.database
      .prepare(
        `INSERT INTO kit_template_line (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column]));
  };

  const insertKitLine = (kitId, patch = {}) => {
    const row = {
      kit_id: kitId,
      section: "顶进设备",
      sort_order: 0,
      line_kind: "material",
      name_text: "排泥钢管",
      planned_qty: 1,
      source: "warehouse",
      created_at: NOW,
      ...patch
    };
    const columns = Object.keys(row);
    return h.database
      .prepare(
        `INSERT INTO project_kit_line (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column]));
  };

  it("四张表存在，约束生效", () => {
    const templateId = h.seed.kitTemplate({ name: "土压平衡" });
    expect(() => h.seed.kitTemplate({ name: "土压平衡" })).toThrow(/UNIQUE/);
    expect(() =>
      insertTemplateLine(templateId, { line_kind: "device", device_category_id: null })
    ).toThrow(/CHECK/);
    expect(() => insertTemplateLine(templateId, { default_qty: -1 })).toThrow(/CHECK/);
    expect(() => insertTemplateLine(templateId, { line_kind: "tool" })).toThrow(/CHECK/);
    expect(() => insertTemplateLine(templateId, { default_qty: null })).not.toThrow();

    const projectId = h.seed.project();
    const kitId = h.seed.kit({ project_id: projectId });
    expect(() => insertKitLine(kitId, { source: "borrowed" })).toThrow(/CHECK/);
    expect(() => insertKitLine(kitId, { planned_qty: -2 })).toThrow(/CHECK/);
    expect(() => insertKitLine(kitId, { line_kind: "device" })).toThrow(/CHECK/);
    expect(() => h.seed.kit({ project_id: projectId, status: "approved" })).toThrow(/CHECK/);
  });

  it("种子：模板和清单带行，行有默认值", () => {
    const category = h.seed.category("顶管机");
    const templateId = h.seed.kitTemplate({}, [
      { line_kind: "device", device_category_id: category, name_text: "机头土压" },
      { name_text: "电焊条", default_qty: 5 }
    ]);
    expect(
      h.database
        .prepare(
          "SELECT sort_order, line_kind, name_text, default_qty FROM kit_template_line WHERE template_id = ? ORDER BY sort_order"
        )
        .all(templateId)
        .map((row) => ({ ...row }))
    ).toEqual([
      { sort_order: 0, line_kind: "device", name_text: "机头土压", default_qty: 1 },
      { sort_order: 1, line_kind: "material", name_text: "电焊条", default_qty: 5 }
    ]);
    const kitId = h.seed.kit({ project_id: h.seed.project() }, [{ name_text: "电焊条" }]);
    expect({
      ...h.database
        .prepare(
          "SELECT status, confirmed_at IS NOT NULL AS confirmed FROM project_kit WHERE id = ?"
        )
        .get(kitId)
    }).toEqual({ status: "confirmed", confirmed: 1 });
    expect({
      ...h.database
        .prepare("SELECT source, planned_qty FROM project_kit_line WHERE kit_id = ?")
        .get(kitId)
    }).toEqual({ source: "warehouse", planned_qty: 1 });
  });

  it("wh_doc.project_kit_id 有索引", () => {
    const names = h.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'wh_doc'")
      .all()
      .map((row) => row.name);
    expect(names).toContain("idx_wh_doc_project_kit_id");
  });
});
