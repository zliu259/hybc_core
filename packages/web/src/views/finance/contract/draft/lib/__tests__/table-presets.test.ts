import { describe, expect, it } from "vitest";
import {
  computeRowAmount,
  computeTableTotal,
  editableColumns,
  emptyRow,
  getPresetColumns,
  parseTable,
  presetForSection,
  sectionHasTable,
  serializeTable,
  tableToGrid,
  tableToPlainText,
  validateTable,
  type ContractTable
} from "../table-presets";

describe("presetForSection", () => {
  it("maps equipment_schedule default variant to wet (with operator column)", () => {
    expect(presetForSection("equipment_schedule", "default")).toBe(
      "equipment_wet"
    );
    const cols = getPresetColumns("equipment_wet").map(c => c.key);
    expect(cols).toContain("operator");
    expect(cols).toContain("work_content");
  });

  it("maps equipment_schedule dry_lease to dry (no operator / work_content)", () => {
    expect(presetForSection("equipment_schedule", "dry_lease")).toBe(
      "equipment_dry"
    );
    const cols = getPresetColumns("equipment_dry").map(c => c.key);
    expect(cols).not.toContain("operator");
    expect(cols).not.toContain("work_content");
  });

  it("maps goods_spec to goods and returns null for non-table sections", () => {
    expect(presetForSection("goods_spec", "default")).toBe("goods");
    expect(presetForSection("payment", "default")).toBeNull();
    expect(sectionHasTable("equipment_schedule", "dry_lease")).toBe(true);
    expect(sectionHasTable("dispute", "default")).toBe(false);
  });
});

describe("amount computation", () => {
  it("computes row amount = qty × unit_price, tolerating strings and commas", () => {
    expect(computeRowAmount({ qty: 3, unit_price: 1200 })).toBe(3600);
    expect(computeRowAmount({ qty: "2", unit_price: "1,500.50" })).toBe(3001);
    expect(computeRowAmount({ qty: "", unit_price: 1200 })).toBe(0);
    expect(computeRowAmount({ qty: 2, unit_price: "abc" })).toBe(0);
  });

  it("rounds to 2 decimals and sums the table total", () => {
    const table: ContractTable = {
      preset: "goods",
      rows: [
        { qty: 3, unit_price: 10.333 },
        { qty: 1, unit_price: 5 }
      ]
    };
    // 3 × 10.333 = 30.999 → 31.00; + 5 = 36
    expect(computeTableTotal(table)).toBe(36);
  });
});

describe("emptyRow / editableColumns", () => {
  it("seeds default values and excludes computed columns", () => {
    const row = emptyRow("equipment_wet");
    expect(row.tax_rate).toBe("13%");
    expect(row.name).toBe("");
    expect("seq" in row).toBe(false);
    expect("amount" in row).toBe(false);
    const keys = editableColumns("goods").map(c => c.key);
    expect(keys).not.toContain("seq");
    expect(keys).not.toContain("amount");
  });
});

describe("parseTable / serializeTable round-trip", () => {
  it("returns null for empty, malformed, or bad-preset json", () => {
    expect(parseTable(null)).toBeNull();
    expect(parseTable("{bad")).toBeNull();
    expect(parseTable(JSON.stringify({ preset: "nope", rows: [] }))).toBeNull();
  });

  it("strips computed/empty cells on serialize and re-parses", () => {
    const table: ContractTable = {
      preset: "equipment_wet",
      rows: [
        {
          name: "挖掘机",
          qty: 2,
          unit_price: 800,
          operator: "含操作人员",
          amount: 999,
          seq: 1,
          spec: ""
        }
      ]
    };
    const json = serializeTable(table);
    const parsed = JSON.parse(json) as {
      preset: string;
      rows: Record<string, unknown>[];
    };
    expect(parsed.preset).toBe("equipment_wet");
    expect("amount" in parsed.rows[0]).toBe(false);
    expect("seq" in parsed.rows[0]).toBe(false);
    expect("spec" in parsed.rows[0]).toBe(false); // empty string dropped
    expect(parsed.rows[0].name).toBe("挖掘机");
    expect(parseTable(json)?.rows[0].operator).toBe("含操作人员");
  });
});

describe("validateTable", () => {
  it("flags missing required cells including wet operator", () => {
    const table: ContractTable = {
      preset: "equipment_wet",
      rows: [
        {
          name: "挖掘机",
          spec: "PC200",
          work_content: "土方",
          unit: "台班",
          qty: 2,
          unit_price: 800
        }
      ]
    };
    const errors = validateTable(table);
    // operator 未填 → 必报
    expect(errors.some(e => e.colKey === "operator")).toBe(true);
  });

  it("passes a fully-filled wet row and empty tables", () => {
    const ok: ContractTable = {
      preset: "equipment_wet",
      rows: [
        {
          name: "挖掘机",
          spec: "PC200",
          work_content: "土方开挖",
          unit: "台班",
          qty: 2,
          unit_price: 800,
          operator: "含操作人员"
        }
      ]
    };
    expect(validateTable(ok)).toHaveLength(0);
    expect(validateTable({ preset: "goods", rows: [] })).toHaveLength(0);
  });
});

describe("tableToPlainText", () => {
  it("renders header, rows with computed amount, and total", () => {
    const table: ContractTable = {
      preset: "goods",
      rows: [
        {
          name: "螺纹钢",
          spec: "HRB400 12mm",
          unit: "吨",
          qty: 10,
          unit_price: 3800
        }
      ]
    };
    const text = tableToPlainText(table);
    expect(text).toContain("货物名称");
    expect(text).toContain("螺纹钢");
    expect(text).toContain("38,000.00");
    expect(text).toContain("合计：¥38,000.00");
  });

  it("returns empty string for an empty table", () => {
    expect(tableToPlainText({ preset: "goods", rows: [] })).toBe("");
  });
});

describe("tableToGrid", () => {
  it("builds header/widths and a total row aligned to the amount column", () => {
    const table: ContractTable = {
      preset: "goods",
      rows: [
        { name: "水泥", spec: "P.O42.5", unit: "吨", qty: 100, unit_price: 420 }
      ]
    };
    const grid = tableToGrid(table);
    expect(grid.header[0]).toBe("序号");
    expect(grid.widths).toHaveLength(grid.header.length);
    // 数据行 + 合计行
    expect(grid.rows).toHaveLength(2);
    expect(grid.rows[0][0]).toBe("1"); // seq
    const amountIdx = getPresetColumns("goods").findIndex(
      c => c.type === "amount"
    );
    expect(grid.rows[0][amountIdx]).toBe("42,000.00");
    const totalRow = grid.rows[1];
    expect(totalRow[0]).toBe("合计");
    expect(totalRow[amountIdx]).toBe("42,000.00");
  });

  it("returns no rows for an empty table", () => {
    expect(tableToGrid({ preset: "goods", rows: [] }).rows).toHaveLength(0);
  });
});
