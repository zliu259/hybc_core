// packages/api/test/cf-ai-models.test.ts
import { describe, it, expect } from "vitest";
import { CF_AI_MODELS, pickDraftModel, pickCriticModel, isCfAiTaskType } from "../src/services/cf-ai";

describe("cf_ai 模型选择", () => {
  it("起草模型按节序交替均衡", () => {
    expect(pickDraftModel(0)).toBe(CF_AI_MODELS[0]);
    expect(pickDraftModel(1)).toBe(CF_AI_MODELS[1]);
    expect(pickDraftModel(2)).toBe(CF_AI_MODELS[0]);
  });
  it("审查模型与起草模型异厂商", () => {
    expect(pickCriticModel(CF_AI_MODELS[0])).toBe(CF_AI_MODELS[1]);
    expect(pickCriticModel(CF_AI_MODELS[1])).toBe(CF_AI_MODELS[0]);
  });
  it("任务类型判别", () => {
    expect(isCfAiTaskType("contract_draft_section")).toBe(true);
    expect(isCfAiTaskType("contract_review")).toBe(false);
  });
});
