import { describe, expect, it } from "vitest";

import { TABLE_SENTINEL, validateTableJson } from "./contract-draft-table";
import {
  collectUnresolvedKeys,
  fillPlaceholdersForAi
} from "./contract-draft-finalize";

describe("validateTableJson", () => {
  it("accepts a well-formed equipment_wet table and normalizes it", () => {
    const raw = JSON.stringify({
      preset: "equipment_wet",
      rows: [{ name: "挖掘机", qty: 3, unit_price: 1200, operator: "含操作人员" }],
      // 多余字段应被剔除
      summary: { amount_total: 3600 }
    });
    const res = validateTableJson(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const parsed = JSON.parse(res.value) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(["preset", "rows"]);
      expect(parsed.preset).toBe("equipment_wet");
    }
  });

  it("rejects an unknown preset", () => {
    const res = validateTableJson(JSON.stringify({ preset: "nope", rows: [] }));
    expect(res.ok).toBe(false);
  });

  it("rejects non-JSON, non-object, and non-array rows", () => {
    expect(validateTableJson("{not json").ok).toBe(false);
    expect(validateTableJson(JSON.stringify([1, 2])).ok).toBe(false);
    expect(validateTableJson(JSON.stringify({ preset: "goods", rows: {} })).ok).toBe(false);
  });

  it("rejects too many rows and overlong cells", () => {
    const many = { preset: "goods", rows: Array.from({ length: 201 }, () => ({ name: "x" })) };
    expect(validateTableJson(JSON.stringify(many)).ok).toBe(false);
    const long = { preset: "goods", rows: [{ name: "x".repeat(501) }] };
    expect(validateTableJson(JSON.stringify(long)).ok).toBe(false);
  });

  it("rejects non-finite numbers and drops null cells", () => {
    // JSON 不能直接表示 Infinity；构造后手动注入
    const res = validateTableJson('{"preset":"goods","rows":[{"qty":1e400}]}');
    expect(res.ok).toBe(false);
    const withNull = validateTableJson(
      JSON.stringify({ preset: "goods", rows: [{ name: "x", spec: null }] })
    );
    expect(withNull.ok).toBe(true);
    if (withNull.ok) {
      const parsed = JSON.parse(withNull.value) as { rows: Record<string, unknown>[] };
      expect("spec" in parsed.rows[0]).toBe(false);
    }
  });
});

describe("finalize placeholder handling of the table sentinel", () => {
  const text = `设备清单如下：\n{{${TABLE_SENTINEL}}}\n单价见{{unit_price}}。`;

  it("does not flag __table__ as an unresolved keyword", () => {
    const unresolved = collectUnresolvedKeys([text], {});
    expect(unresolved).toContain("unit_price");
    expect(unresolved).not.toContain(TABLE_SENTINEL);
  });

  it("replaces the sentinel with a human-readable note when feeding AI", () => {
    const filled = fillPlaceholdersForAi(text, { unit_price: "1200 元/台班" });
    expect(filled).not.toContain(TABLE_SENTINEL);
    expect(filled).toContain("（详见清单表格）");
    expect(filled).toContain("1200 元/台班");
  });
});
