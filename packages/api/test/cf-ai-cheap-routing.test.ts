// packages/api/test/cf-ai-cheap-routing.test.ts
import { describe, it, expect } from "vitest";
import {
  CF_AI_CHEAP_MODEL,
  CF_AI_MODELS,
  parseCfAiTextOutput,
  pickSectionModel
} from "../src/services/cf-ai";

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
