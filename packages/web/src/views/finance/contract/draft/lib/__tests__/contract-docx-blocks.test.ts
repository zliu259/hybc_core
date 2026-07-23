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

const paragraphTexts = (
  blocks: ReturnType<typeof buildContractDocxBlocks>
): string[] => blocks.flatMap(b => (b.type === "paragraph" ? [b.text] : []));

describe("buildContractDocxBlocks", () => {
  it("emits a centered title as the first block", () => {
    const blocks = buildContractDocxBlocks("设备租赁合同", [
      section({
        title: "首部",
        section_key: "parties_basis",
        content: "甲乙双方…"
      })
    ]);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      text: "设备租赁合同",
      style: "title"
    });
  });

  it("numbers clauses with Chinese ordinals, skipping 首部/落款", () => {
    const blocks = buildContractDocxBlocks("合同", [
      section({
        section_key: "parties_basis",
        title: "首部",
        content: "甲乙双方…"
      }),
      section({
        section_key: "lease_term",
        title: "租赁期限",
        content: "自 A 至 B。"
      }),
      section({ section_key: "payment", title: "租金支付", content: "月结。" }),
      section({
        section_key: "signature_block",
        title: "落款",
        content: "甲方：___"
      })
    ]);
    const texts = paragraphTexts(blocks);
    // 首部/落款不出现条号
    expect(texts.some(t => t.startsWith("第") && t.includes("首部"))).toBe(
      false
    );
    expect(texts.some(t => t.startsWith("第") && t.includes("落款"))).toBe(
      false
    );
    // 两个中间条款依次为第一条 / 第二条
    expect(texts).toContain("第一条　租赁期限");
    expect(texts).toContain("第二条　租金支付");
    // 首部正文顶格(plain)，条款正文首行缩进(body)
    const preamble = blocks.find(
      b => b.type === "paragraph" && b.text === "甲乙双方…"
    );
    expect(preamble && preamble.type === "paragraph" && preamble.style).toBe(
      "plain"
    );
    const clauseBody = blocks.find(
      b => b.type === "paragraph" && b.text === "自 A 至 B。"
    );
    expect(
      clauseBody && clauseBody.type === "paragraph" && clauseBody.style
    ).toBe("body");
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
    const texts = paragraphTexts(blocks);
    expect(texts).toContain("上文");
    expect(texts).toContain("下文");
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
