import { describe, expect, it } from "vitest";
import { buildContractDocxBlocks } from "../contract-docx-blocks";
import { serializeTable, type ContractTable } from "../table-presets";
import type { FixedSection } from "@/api/contract-draft";

const section = (over: Partial<FixedSection>): FixedSection => ({
  id: 1,
  section_key: "misc",
  title: "条款",
  content: "",
  table_json: null,
  ...over
});

const wetTable: ContractTable = {
  preset: "equipment_wet",
  rows: [
    {
      name: "挖掘机",
      spec: "PC200",
      work_content: "土方",
      unit: "台班",
      qty: 2,
      unit_price: 800,
      operator: "含操作人员"
    }
  ]
};

describe("buildContractDocxBlocks", () => {
  it("emits a title heading and a trailing disclaimer paragraph", () => {
    const blocks = buildContractDocxBlocks("设备租赁合同", [
      section({ title: "首部", content: "甲乙双方…" })
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      text: "设备租赁合同",
      heading: true
    });
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe("paragraph");
    expect(last.type === "paragraph" && last.text).toContain("AI 辅助起草");
  });

  it("appends a table block at the section end when content has no sentinel", () => {
    const blocks = buildContractDocxBlocks("合同", [
      section({
        section_key: "equipment_schedule",
        title: "设备清单",
        content: "详见清单。",
        table_json: serializeTable(wetTable)
      })
    ]);
    const tables = blocks.filter(b => b.type === "table");
    expect(tables).toHaveLength(1);
    // 表格出现在该节正文之后
    const contentIdx = blocks.findIndex(
      b => b.type === "paragraph" && b.text === "详见清单。"
    );
    const tableIdx = blocks.findIndex(b => b.type === "table");
    expect(tableIdx).toBeGreaterThan(contentIdx);
  });

  it("inserts the table at the {{__table__}} sentinel and drops the raw sentinel text", () => {
    const blocks = buildContractDocxBlocks("合同", [
      section({
        section_key: "equipment_schedule",
        title: "设备清单",
        content: "上文\n{{__table__}}\n下文",
        table_json: serializeTable(wetTable)
      })
    ]);
    const texts = blocks
      .filter(
        (b): b is { type: "paragraph"; text: string; heading?: boolean } =>
          b.type === "paragraph"
      )
      .map(b => b.text);
    expect(texts).toContain("上文");
    expect(texts).toContain("下文");
    // 原始哨兵不得出现在成稿
    expect(texts.some(t => t.includes("__table__"))).toBe(false);
    const tableIdx = blocks.findIndex(b => b.type === "table");
    const upIdx = blocks.findIndex(
      b => b.type === "paragraph" && b.text === "上文"
    );
    const downIdx = blocks.findIndex(
      b => b.type === "paragraph" && b.text === "下文"
    );
    expect(tableIdx).toBeGreaterThan(upIdx);
    expect(tableIdx).toBeLessThan(downIdx);
  });

  it("emits no table block when a table section has no rows", () => {
    const blocks = buildContractDocxBlocks("合同", [
      section({
        section_key: "goods_spec",
        title: "货物清单",
        content: "以下为清单：",
        table_json: serializeTable({ preset: "goods", rows: [] })
      })
    ]);
    expect(blocks.some(b => b.type === "table")).toBe(false);
  });
});
