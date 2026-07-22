// packages/api/test/contract-draft-rules-v2.test.ts
// 规则层 v2：生产样本挖掘出的真实变体（见 docs/superpowers/specs/2026-07-22-contract-sample-findings.md）
import { describe, it, expect } from "vitest";
import { checkClauseText } from "../src/services/contract-draft-rules";

const hasLevel = (text: string, level: "red" | "yellow"): boolean =>
  checkClauseText(text).some((f) => f.level === level);

describe("规则层 v2：背靠背变体", () => {
  it("字面『背靠背』红标", () => {
    expect(hasLevel("特别提示：背靠背，即建设单位不付款则甲方无须支付。", "red")).toBe(true);
  });
  it("『按回款进度同比例支付』红标", () => {
    expect(hasLevel("付款按照本工程回款进度同比例向乙方支付工程款。", "red")).toBe(true);
  });
  it("『以建设方拨付的工程进度款为依据』红标", () => {
    expect(hasLevel("劳务款支付以建设方拨付的工程进度款为依据。", "red")).toBe(true);
  });
  it("防御性条款『不得以第三方付款作为支付前提』不误报", () => {
    expect(checkClauseText("甲方不得以第三方付款作为向乙方支付的前提。")).toEqual([]);
  });
});

describe("规则层 v2：预先弃权与抗辩权放弃", () => {
  it("『不向甲方主张任何违约责任』红标", () => {
    expect(hasLevel("乙方承诺不向甲方主张任何违约责任、利息损失等赔偿责任。", "red")).toBe(true);
  });
  it("『不再支付任何形式的违约金』红标", () => {
    expect(hasLevel("发包人除支付必要的窝工费用以外，不再支付任何形式的违约金。", "red")).toBe(
      true
    );
  });
  it("『不得停止履行』黄标", () => {
    expect(hasLevel("乙方不得因甲方未支付款项而停止履行本合同义务。", "yellow")).toBe(true);
  });
});

describe("规则层 v2：绝对免责与责任主体固定", () => {
  it("『一切事故均与甲方无关』红标", () => {
    expect(hasLevel("乙方在施工过程中所发生的一切事故，均与甲方无关。", "red")).toBe(true);
  });
  it("『事故的责任主体为承包人』红标", () => {
    expect(hasLevel("必须明确事故的责任主体为承包人，不得将经济损失转移到发包人。", "red")).toBe(
      true
    );
  });
});

describe("规则层 v2：质保金反序与畸高日息", () => {
  it("『扣留20%的质保金』（比例在前）红标", () => {
    expect(hasLevel("每期结算扣留20%的质保金，待验收合格后支付。", "red")).toBe(true);
  });
  it("『3%的质保金』不误报", () => {
    expect(checkClauseText("预留3%的质保金，缺陷责任期满后返还。")).toEqual([]);
  });
  it("『每拖延一日按月租赁费的5%』黄标", () => {
    expect(
      hasLevel("每拖延一日乙方应当按照未进场设备月租赁费的5%向甲方支付违约金。", "yellow")
    ).toBe(true);
  });
});

describe("规则层 v2：模糊账期与无限异议期", () => {
  it("『年底前支付』黄标", () => {
    expect(hasLevel("无预付款，工作完成后于年底前支付至合同总价的70%。", "yellow")).toBe(true);
  });
  it("『自发现之日起』异议期黄标", () => {
    expect(hasLevel("甲方有权在发现货物质量问题之日起15日内提出异议并索赔。", "yellow")).toBe(true);
  });
  it("正常付款条款不误报", () => {
    expect(checkClauseText("甲方应于验收合格后30日内支付工程款。")).toEqual([]);
  });
});
