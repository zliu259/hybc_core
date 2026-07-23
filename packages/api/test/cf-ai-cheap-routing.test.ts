import { describe, it, expect } from "vitest";
// packages/api/test/cf-ai-cheap-routing.test.ts
import {
  CF_AI_COMPLETENESS_MODELS,
  CF_AI_DRAFT_MODEL,
  CF_AI_REVIEW_MODEL,
  parseCfAiTextOutput,
  raceWithTimeout
} from "../src/services/cf-ai";

describe("模型分工（owner 07-23）", () => {
  it("生成统一走 luna", () => {
    expect(CF_AI_DRAFT_MODEL).toBe("openai/gpt-5.6-luna");
  });
  it("AI 审查固定 sonnet-5", () => {
    expect(CF_AI_REVIEW_MODEL).toBe("anthropic/claude-sonnet-5");
  });
  it("完整性检查 terra+sonnet-5 双模型", () => {
    expect([...CF_AI_COMPLETENESS_MODELS]).toEqual([
      "openai/gpt-5.6-terra",
      "anthropic/claude-sonnet-5"
    ]);
  });
});

describe("parseCfAiTextOutput（GLM等reasoning模型返回形状宽容解析）", () => {
  it("解析 {response}", () => {
    expect(parseCfAiTextOutput({ response: "正文" })).toBe("正文");
  });
  it("解析 OpenAI 兼容 choices 结构", () => {
    expect(parseCfAiTextOutput({ choices: [{ message: { content: "内容A" } }] })).toBe("内容A");
  });
  it("解析嵌套 result.response", () => {
    expect(parseCfAiTextOutput({ result: { response: "R" } })).toBe("R");
  });
  it("剥离闭合的 <think> 推理块", () => {
    expect(parseCfAiTextOutput({ response: '<think>推理过程</think>{"content":"x"}' })).toBe(
      '{"content":"x"}'
    );
  });
  it("剥离被截断的未闭合 <think> 块（视为空输出触发降级）", () => {
    expect(parseCfAiTextOutput({ response: "<think>推理到一半被 max_tokens 截断" })).toBe("");
  });
  it("空白/未知形状返回空串", () => {
    expect(parseCfAiTextOutput({ response: "   " })).toBe("");
    expect(parseCfAiTextOutput(null)).toBe("");
  });
});

describe("raceWithTimeout", () => {
  it("按时完成则透传结果", async () => {
    await expect(raceWithTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });
  it("超时则拒绝并携带超时信息", async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 200);
    });
    await expect(raceWithTimeout(slow, 20)).rejects.toThrow("调用超时");
  });
});
