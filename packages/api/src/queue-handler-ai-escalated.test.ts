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

type FakeEnvOptions = {
  /** 节点上是否仍有 pending 人工任务；false 模拟事件重投时审核人已处理 */
  hasPendingHumanTask?: boolean;
};

const createFakeEnv = ({ hasPendingHumanTask = true }: FakeEnvOptions = {}) => {
  const eventLogTypes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              // 重投守卫的探测查询（hasPendingHumanTaskOnNode）走 first()
              if (/FROM\s+approval_task[\s\S]*status\s*=\s*'pending'/.test(sql)) {
                return (hasPendingHumanTask ? { id: 9 } : null) as unknown as T;
              }
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
    pushMock.resolveApprovalPushMeta.mockClear();
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
    // 单个受理人发送失败由 handleApprovalSubmitted 自行吞掉，不该升级成隔离兜底
    expect(eventLogTypes).not.toContain("wecom_template_card_isolation_guard");
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

  it("待办卡整段失败（取推卡元数据报错）只记隔离兜底，结果卡照发", async () => {
    const { env, eventLogTypes } = createFakeEnv();
    // handleApprovalSubmitted 里 resolveApprovalPushMeta 抛错会整段冒泡，需被隔离兜底接住；
    // Once 只作用于第一次调用，结果卡那次仍拿到正常元数据
    pushMock.resolveApprovalPushMeta.mockRejectedValueOnce(new Error("d1 down"));

    await handleApprovalAiEscalated(env, { instance_id: 362, reviewer_userid: "Boss" });

    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(eventLogTypes).toContain("wecom_template_card_isolation_guard");
    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(eventLogTypes).toContain("wecom_template_card_result_sent");
  });

  it("无 reviewer_userid 时结果卡用不点名的兜底文案", async () => {
    const { env } = createFakeEnv();

    await handleApprovalAiEscalated(env, { instance_id: 362 });

    expect(pushMock.sendApprovalResultTemplateCard).toHaveBeenCalledTimes(1);
    expect(pushMock.sendApprovalResultTemplateCard.mock.calls[0][1]).toMatchObject({
      resultType: "escalated",
      resultReason: "AI 审查未通过，等待人工复核"
    });
  });

  it("事件重投而节点上人工任务已处理：跳过推卡只记 skipped", async () => {
    const { env, eventLogTypes } = createFakeEnv({ hasPendingHumanTask: false });

    await handleApprovalAiEscalated(env, {
      instance_id: 362,
      node_instance_id: 1931,
      reviewer_userid: "Boss"
    });

    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(pushMock.sendApprovalResultTemplateCard).not.toHaveBeenCalled();
    expect(eventLogTypes).toContain("ai_gate_escalation_push_skipped");
  });

  it("instance_id 非法直接返回", async () => {
    const { env } = createFakeEnv();

    await handleApprovalAiEscalated(env, { instance_id: 0 });
    await handleApprovalAiEscalated(env, { instance_id: "abc" });

    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(pushMock.sendApprovalResultTemplateCard).not.toHaveBeenCalled();
  });

  it("payload 缺 instance_id 直接返回", async () => {
    const { env } = createFakeEnv();

    await handleApprovalAiEscalated(env, { reviewer_userid: "Boss" });

    expect(pushMock.sendApprovalTodoTemplateCard).not.toHaveBeenCalled();
    expect(pushMock.sendApprovalResultTemplateCard).not.toHaveBeenCalled();
  });
});
