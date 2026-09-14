import { describe, expect, it } from "vitest";
import type { ApprovalAiGateTaskItem } from "@/api/admin";
import { canPushAiGateFlow, taskRoundLabel } from "./ai-gate-actions";

const makeInstance = (
  status: string,
  currentRound: number
): NonNullable<ApprovalAiGateTaskItem["instance"]> => ({
  id: 1,
  instance_no: "AP-20260914-0001",
  status,
  biz_type: "payment",
  biz_summary: "付款申请",
  initiator_userid: "Boss",
  current_round: currentRound,
  current_node_key: "ai_gate"
});

describe("canPushAiGateFlow", () => {
  it("实例查不到时不拦前端，交由后端判定", () => {
    expect(canPushAiGateFlow({ task_round: 1, instance: null })).toBe(true);
  });

  it("审批中实例的当前轮任务可以放行/驳回", () => {
    expect(
      canPushAiGateFlow({
        task_round: 2,
        instance: makeInstance("in_progress", 2)
      })
    ).toBe(true);
  });

  it("审批中实例的旧轮任务不可操作（后端会 409）", () => {
    expect(
      canPushAiGateFlow({
        task_round: 1,
        instance: makeInstance("in_progress", 2)
      })
    ).toBe(false);
  });

  it("实例已退回发起人时即使轮次相同也不可操作", () => {
    expect(
      canPushAiGateFlow({
        task_round: 1,
        instance: makeInstance("returned", 1)
      })
    ).toBe(false);
  });
});

describe("taskRoundLabel", () => {
  it("当前轮只显示轮次", () => {
    expect(
      taskRoundLabel({
        task_round: 2,
        instance: makeInstance("in_progress", 2)
      })
    ).toBe("第 2 轮");
  });

  it("实例查不到时按任务自己的轮次显示，不标旧轮", () => {
    expect(taskRoundLabel({ task_round: 1, instance: null })).toBe("第 1 轮");
  });

  it("不是实例当前轮时补「旧轮」", () => {
    expect(
      taskRoundLabel({
        task_round: 1,
        instance: makeInstance("in_progress", 3)
      })
    ).toBe("第 1 轮（旧轮）");
  });
});
