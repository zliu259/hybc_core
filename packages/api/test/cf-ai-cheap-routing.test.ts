// packages/api/test/cf-ai-cheap-routing.test.ts
import { describe, it, expect } from "vitest";
import { CF_AI_CHEAP_MODEL, CF_AI_MODELS, pickSectionModel } from "../src/services/cf-ai";

describe("成本分级路由", () => {
  it("首次起草（无正文）走高档交替", () => {
    expect(pickSectionModel({ hasContent: false, hasInstruction: false, sectionSort: 0 })).toBe(
      CF_AI_MODELS[0]
    );
    expect(pickSectionModel({ hasContent: false, hasInstruction: true, sectionSort: 1 })).toBe(
      CF_AI_MODELS[1]
    );
  });
  it("已有AI/手工正文且带指令的修改走廉价模型", () => {
    expect(pickSectionModel({ hasContent: true, hasInstruction: true, sectionSort: 0 })).toBe(
      CF_AI_CHEAP_MODEL
    );
  });
  it("已有正文但无指令（整节重生成）仍走高档", () => {
    expect(pickSectionModel({ hasContent: true, hasInstruction: false, sectionSort: 2 })).toBe(
      CF_AI_MODELS[0]
    );
  });
});
