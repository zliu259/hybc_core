import { describe, expect, it } from "vitest";
import {
  buildDraftPlainText,
  composeSectionText
} from "../contract-plain-text";
import { serializeTable, type ContractTable } from "../table-presets";
import type { ContractDraftSection } from "@/api/contract-draft";

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

const section = (over: Partial<ContractDraftSection>): ContractDraftSection =>
  ({
    id: 1,
    draft_id: 1,
    section_key: "equipment_schedule",
    title: "设备清单",
    variant_key: "default",
    source: "manual",
    instruction: null,
    content: "",
    risk_annotations_json: null,
    ai_task_id: null,
    ai_status: null,
    review_task_id: null,
    review_status: null,
    review_result_json: null,
    table_json: null,
    sort_order: 10,
    status: "active",
    created_at: "",
    updated_at: "",
    ...over
  }) as ContractDraftSection;

describe("composeSectionText", () => {
  it("renders the wet equipment table (the preview bug) after the clause text", () => {
    const text = composeSectionText("设备清单如下：", serializeTable(wetTable));
    expect(text).toContain("设备清单如下：");
    // 湿租含操作人员列与行值必须出现在纯文本
    expect(text).toContain("是否含操作人员");
    expect(text).toContain("含操作人员");
    expect(text).toContain("挖掘机");
    expect(text).toContain("合计：¥1,600.00");
  });

  it("inserts the table at the {{__table__}} sentinel and drops the raw sentinel", () => {
    const text = composeSectionText(
      "上文\n{{__table__}}\n下文",
      serializeTable(wetTable)
    );
    expect(text).not.toContain("__table__");
    const upIdx = text.indexOf("上文");
    const tableIdx = text.indexOf("挖掘机");
    const downIdx = text.indexOf("下文");
    expect(upIdx).toBeLessThan(tableIdx);
    expect(tableIdx).toBeLessThan(downIdx);
  });

  it("removes a leftover sentinel when there is no table data", () => {
    expect(composeSectionText("正文{{__table__}}", null)).toBe("正文");
    expect(
      composeSectionText(
        "正文{{__table__}}",
        serializeTable({ preset: "goods", rows: [] })
      )
    ).toBe("正文");
  });

  it("leaves plain clause text untouched", () => {
    expect(composeSectionText("普通条款正文。", null)).toBe("普通条款正文。");
  });
});

describe("buildDraftPlainText", () => {
  it("fills placeholders and includes the table in the full preview", () => {
    const text = buildDraftPlainText(
      "设备租赁合同",
      [
        section({
          title: "首部",
          section_key: "parties_basis",
          content: "甲方：{{party_a}}"
        }),
        section({
          title: "设备清单",
          content: "见下表：",
          table_json: serializeTable(wetTable)
        })
      ],
      { party_a: "恒越百川" }
    );
    expect(text).toContain("设备租赁合同");
    expect(text).toContain("第1节 首部");
    expect(text).toContain("甲方：恒越百川"); // 占位符已填充
    expect(text).toContain("第2节 设备清单");
    expect(text).toContain("挖掘机"); // 清单进入预览
  });
});
