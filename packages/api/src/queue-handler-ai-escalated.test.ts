import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./types/env";

// 显式声明推卡函数签名，断言里才能按下标取到第二个入参（卡片参数对象）
type PushCardResult = {
  msgid: string;
  invaliduser: string | null;
  unlicenseduser: string | null;
};
type PushCardFn = (env: unknown, params: Record<string, unknown>) => Promise<PushCardResult>;

const pushMock = vi.hoisted(() => ({
  sendApprovalTodoTemplateCard: vi.fn<PushCardFn>(async () => ({
    msgid: "m1",
    invaliduser: null,
    unlicenseduser: null
  })),
  sendApprovalResultTemplateCard: vi.fn<PushCardFn>(async () => ({
    msgid: "m2",
    invaliduser: null,
    unlicenseduser: null
  })),
  resolveApplicantDisplayName: vi.fn(async (_env: unknown, userid: string) =>
    userid === "Boss" ? "刘老板" : userid === "UserA" ? "小王" : userid
  ),
  resolveApprovalPushMeta: vi.fn(async () => ({
    requestTitle: "首笔预付款",
    amountText: "¥20,000.00"
  }))
}));

vi.mock("./services/wecom-approval-push", () => ({
  sendApprovalTodoTemplateCard: pushMock.sendApprovalTodoTemplateCard,
  sendApprovalResultTemplateCard: pushMock.sendApprovalResultTemplateCard,
  resolveApplicantDisplayName: pushMock.resolveApplicantDisplayName,
  resolveApprovalPushMeta: pushMock.resolveApprovalPushMeta
}));

import { handleApprovalAiEscalated } from "./queue-handler";

const createFakeEnv = () => {
  const eventLogTypes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+approval_instance\s+ai/i.test(sql)) {
                return {
                  id: 362,
                  instance_no: "SP-20260913-0007",
                  biz_type: "payment_request",
                  biz_id: 2899,
                  biz_summary: "智能发单台-首笔预付款",
                  initiator_userid: "UserA",
                  current_node_name: "AI关卡"
                } as unknown as T;
              }
              return null as unknown as T;
            },
            async all<T>() {
              if (/FROM\s+approval_task/i.test(sql)) {
                return { results: [{ assignee_userid: "Boss" }] as unknown as T[] };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (/INSERT\s+INTO\s+event_log/i.test(sql)) eventLogTypes.push(String(args[0]));
              return { success: true, meta: {} };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, eventLogTypes };
};

describe("handleApprovalAiEscalated", () => {
  beforeEach(() => {
    pushMock.sendApprovalTodoTemplateCard.mockClear();
    pushMock.sendApprovalResultTemplateCard.mockClear();
  });

  it("给审核人推待办卡，给发起人推 escalated 结果卡并点名审核人", async () => {
    const { env, eventLogTypes } = createFakeEnv();

    await handleApprovalAiEscalated(env, {
      instance_id: 362,
      instance_no: "SP-20260913-0007",
      node_instance_id: 1931,
      reviewer_userid: "Boss",
      reason: "AI审查不通过：附件费用对象与收款方不一致"
    });

    expect(pushMock.sendApprovalTodoTemplateCard).toHaveBeenCalledTimes(1);
    expect(pushMock.sendApprovalTodoTemplateCard.mock.calls[0][1]).toMatchObject({
      instanceId: 362,
      assigneeUserId: "Boss",
      currentNodeName: "AI关卡"
    });
    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(pushMock.sendApprovalResultTemplateCard.mock.calls[0][1]).toMatchObject({
      instanceId: 362,
      initiatorUserId: "UserA",
      resultType: "escalated",
      resultReason: "AI 审查未通过，等待 刘老板 人工复核"
    });
    expect(eventLogTypes).toContain("wecom_template_card_sent");
    expect(eventLogTypes).toContain("wecom_template_card_result_sent");
  });

  it("待办卡发送失败不影响发起人结果卡：失败由推卡函数自行记 wecom_template_card_failed", async () => {
    const { env, eventLogTypes } = createFakeEnv();
    pushMock.sendApprovalTodoTemplateCard.mockRejectedValueOnce(new Error("wecom down"));

    await handleApprovalAiEscalated(env, { instance_id: 362, reviewer_userid: "Boss" });

    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(eventLogTypes).toContain("wecom_template_card_failed");
    expect(eventLogTypes).toContain("wecom_template_card_result_sent");
  });

  it("结果卡发送失败只记 result isolation guard，不抛出", async () => {
    const { env, eventLogTypes } = createFakeEnv();
    pushMock.sendApprovalResultTemplateCard.mockRejectedValueOnce(new Error("wecom down"));

    await expect(
      handleApprovalAiEscalated(env, { instance_id: 362, reviewer_userid: "Boss" })
    ).resolves.toBeUndefined();

    expect(eventLogTypes).toContain("wecom_template_card_result_failed");
    expect(eventLogTypes).toContain("wecom_template_card_result_isolation_guard");
  });

  it("instance_id 非法直接返回", async () => {
    const { env } = createFakeEnv();
    await handleApprovalAiEscalated(env, { instance_id: 0 });
    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(pushMock.sendApprovalResultTemplateCard).not.toHaveBeenCalled();
  });
});
