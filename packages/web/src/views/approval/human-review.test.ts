import { describe, expect, it } from "vitest";
import { humanReviewStatusText, isAiGateHumanReviewTask } from "./human-review";

const task = (
  over: Partial<{
    assignee_userid: string;
    status: string;
    action: string | null;
  }>
) => ({
  id: 1,
  node_instance_id: 5,
  instance_id: 1,
  assignee_userid: "Boss",
  action: null,
  comment: null,
  round: 1,
  status: "pending",
  acted_at: null,
  created_at: "",
  updated_at: "",
  ...over
});

describe("isAiGateHumanReviewTask", () => {
  it("关卡节点上的真人任务为人工复核", () => {
    expect(isAiGateHumanReviewTask("ai_gate", task({}))).toBe(true);
  });
  it("AI_GATE 自身任务不是", () => {
    expect(
      isAiGateHumanReviewTask("ai_gate", task({ assignee_userid: "AI_GATE" }))
    ).toBe(false);
  });
  it("非关卡节点不是", () => {
    expect(isAiGateHumanReviewTask("sequential", task({}))).toBe(false);
  });
});

describe("humanReviewStatusText", () => {
  it("pending 提示等待人工复核", () => {
    expect(humanReviewStatusText(task({}))).toBe("AI 拦截，等待人工复核");
  });
  it("已处理不再提示", () => {
    expect(
      humanReviewStatusText(task({ status: "completed", action: "approve" }))
    ).toBe("");
  });
});
