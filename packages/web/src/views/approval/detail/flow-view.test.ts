import { describe, expect, it } from "vitest";
import type {
  ApprovalDetailResponse,
  ApprovalNodeInstance,
  ApprovalTask
} from "@/api/approval";
import {
  buildRoundNotes,
  isCurrentNode,
  resolveNodeDisplay,
  shouldShowTaskComment,
  taskIdleText
} from "./flow-view";
import { buildStopNotice } from "./notices";

const node = (patch: Partial<ApprovalNodeInstance>): ApprovalNodeInstance =>
  ({
    id: 1,
    node_key: "fin",
    node_type: "sequential",
    node_name: "财务审批",
    status: "pending",
    round: 1,
    sort_order: 1,
    ...patch
  }) as ApprovalNodeInstance;

const task = (patch: Partial<ApprovalTask>): ApprovalTask =>
  ({
    id: 1,
    node_instance_id: 1,
    assignee_userid: "u1",
    action: null,
    comment: null,
    round: 1,
    status: "pending",
    acted_at: null,
    ...patch
  }) as ApprovalTask;

const running = { status: "in_progress", current_round: 1 };

describe("resolveNodeDisplay", () => {
  it("进行中的单子照常显示", () => {
    expect(
      resolveNodeDisplay(node({ status: "in_progress" }), [], running)
    ).toEqual({ label: "进行中", tone: "active" });
    expect(resolveNodeDisplay(node({}), [], running).label).toBe("待处理");
    expect(
      resolveNodeDisplay(node({ status: "completed" }), [], running)
    ).toEqual({ label: "已完成", tone: "success" });
  });

  it("驳回的节点不能写成已完成：引擎把它落成 completed", () => {
    const rejected = resolveNodeDisplay(
      node({ status: "completed" }),
      [task({ action: "reject", status: "completed" })],
      { status: "rejected", current_round: 1 }
    );
    expect(rejected).toEqual({ label: "已驳回", tone: "danger" });
  });

  it("AI 拦截后人工放行：以最后一个决定为准", () => {
    const display = resolveNodeDisplay(
      node({ status: "completed", node_type: "ai_gate" }),
      [
        task({ id: 1, assignee_userid: "AI_GATE", action: "reject" }),
        task({ id: 2, assignee_userid: "AI_GATE", action: "approve" })
      ],
      running
    );
    expect(display.label).toBe("已完成");
  });

  it("流程已结束时，卡住的节点写已中止，没走到的写未执行", () => {
    const cancelled = { status: "cancelled", current_round: 1 };
    expect(
      resolveNodeDisplay(node({ status: "in_progress" }), [], cancelled)
    ).toEqual({ label: "已中止", tone: "muted" });
    expect(
      resolveNodeDisplay(node({ status: "cancelled" }), [], cancelled).label
    ).toBe("已中止");
    expect(resolveNodeDisplay(node({}), [], cancelled)).toEqual({
      label: "未执行",
      tone: "muted"
    });
    expect(
      resolveNodeDisplay(node({}), [], { status: "rejected", current_round: 1 })
        .label
    ).toBe("未执行");
  });

  it("单子在第 3 轮时，前面轮次没走到的节点写未执行，不是待处理", () => {
    const third = { status: "in_progress", current_round: 3 };
    expect(resolveNodeDisplay(node({ round: 1 }), [], third).label).toBe(
      "未执行"
    );
    expect(resolveNodeDisplay(node({ round: 3 }), [], third).label).toBe(
      "待处理"
    );
    expect(
      resolveNodeDisplay(node({ round: 2, status: "returned" }), [], third)
    ).toEqual({ label: "已退回", tone: "warning" });
  });
});

describe("isCurrentNode", () => {
  const props = { status: "in_progress", current_round: 2 };
  it("只有在跑的实例、当前轮、当前节点才高亮", () => {
    const current = node({ node_key: "fin", round: 2, status: "in_progress" });
    expect(isCurrentNode(current, props, "fin")).toBe(true);
    // 撤回后旧轮次留下的进行中节点
    expect(isCurrentNode({ ...current, round: 1 }, props, "fin")).toBe(false);
    expect(
      isCurrentNode(current, { status: "cancelled", current_round: 2 }, "fin")
    ).toBe(false);
    expect(isCurrentNode(current, props, "other")).toBe(false);
  });
});

describe("意见和未处理任务", () => {
  it("通过时「同意」这类字样不重复显示，其他动作的意见都要显示", () => {
    const show = (action: string, comment: string) =>
      shouldShowTaskComment(task({ action, comment, status: "completed" }));
    expect(show("approve", "通过")).toBe(false);
    expect(show("approve", "同意")).toBe(false);
    expect(show("approve", "金额已核对")).toBe(true);
    // 线上真实数据：通过时写的实际意见都要显示，只有恰好是这几个字才隐藏
    for (const comment of ["付款后补发票", "老合同，通过", "同意支付"]) {
      expect(show("approve", comment)).toBe(true);
    }
    expect(show("approve", "同意\n")).toBe(false);
    expect(show("reject", "通过")).toBe(true);
    expect(show("return_initiator", "同意")).toBe(true);
    expect(shouldShowTaskComment(task({ action: "reject" }))).toBe(false);
  });

  it("AI 任务只要有结论就显示", () => {
    expect(
      shouldShowTaskComment(
        task({
          assignee_userid: "AI_GATE",
          action: "approve",
          comment: "AI审查通过：一致"
        })
      )
    ).toBe(true);
  });

  it("流程结束时没轮到的人写未处理，不能只留一个名字", () => {
    expect(taskIdleText(task({ status: "cancelled" }))).toBe("未处理");
    expect(taskIdleText(task({ status: "completed", action: "approve" }))).toBe(
      ""
    );
    expect(taskIdleText(task({ status: "pending" }))).toBe("");
  });
});

const toLabel = (id: string | null | undefined) => `用户${id}`;

const detail = (
  patch: Partial<ApprovalDetailResponse> & { status: string }
): ApprovalDetailResponse => {
  const { status, ...rest } = patch;
  return {
    instance: { status, current_round: 1 },
    nodes: [],
    tasks: [],
    ai_gate_reviews: [],
    initiator_actions: [],
    ...rest
  } as unknown as ApprovalDetailResponse;
};

describe("buildStopNotice：取消和撤回也要说清楚", () => {
  it("SP-20261014-0010 的情形：付款被作废，只有备注里有记录", () => {
    const notice = buildStopNotice(
      detail({ status: "cancelled" }),
      toLabel,
      "代理费\n[超管修改 2026-10-14T12:25:35.474Z] a：改账户\n[VOID 2026-10-14T12:35:37.812Z] boss"
    );
    expect(notice).toMatchObject({
      kind: "cancelled",
      title: "付款单已作废，这笔审批随之取消",
      by: "用户boss",
      comment: "未填写原因",
      at: "2026-10-14T12:35:37.812Z"
    });
  });

  it("作废时填了原因就显示原因", () => {
    const notice = buildStopNotice(
      detail({ status: "cancelled" }),
      toLabel,
      "[VOID 2026-10-14T12:35:37.812Z] boss: 附件对象不符"
    );
    expect(notice?.comment).toBe("附件对象不符");
  });

  it("优先用审批操作记录：新的作废和取消都写在这里", () => {
    const notice = buildStopNotice(
      detail({
        status: "cancelled",
        initiator_actions: [
          {
            action: "cancel",
            userid: "u2",
            comment: "重复提交",
            created_at: "2026-11-01T00:00:00Z"
          }
        ]
      } as Partial<ApprovalDetailResponse> & { status: string }),
      toLabel
    );
    expect(notice).toMatchObject({
      title: "这笔审批已取消",
      by: "用户u2",
      comment: "重复提交"
    });
  });

  it("撤回", () => {
    const notice = buildStopNotice(
      detail({
        status: "withdrawn",
        initiator_actions: [
          {
            action: "withdraw",
            userid: "u3",
            comment: null,
            created_at: "2026-11-01T00:00:00Z"
          }
        ]
      } as Partial<ApprovalDetailResponse> & { status: string }),
      toLabel
    );
    expect(notice).toMatchObject({
      kind: "cancelled",
      title: "发起人已撤回这笔审批",
      by: "用户u3",
      comment: "未填写原因"
    });
  });

  it("什么记录都没有时也不能空着", () => {
    const notice = buildStopNotice(detail({ status: "cancelled" }), toLabel);
    expect(notice).toMatchObject({
      title: "这笔审批已取消",
      by: "",
      comment: "未填写原因",
      at: null
    });
  });

  it("进行中和已通过没有提示", () => {
    expect(
      buildStopNotice(detail({ status: "in_progress" }), toLabel)
    ).toBeNull();
    expect(buildStopNotice(detail({ status: "approved" }), toLabel)).toBeNull();
  });
});

describe("buildRoundNotes：每一轮是怎么结束的", () => {
  const roundDetail = detail({
    status: "in_progress",
    instance: {
      status: "in_progress",
      current_round: 3
    },
    nodes: [
      node({ id: 11, round: 1, status: "in_progress", node_name: "财务审批" }),
      node({ id: 12, round: 1, status: "pending", node_name: "总经理审批" }),
      node({ id: 21, round: 2, status: "returned", node_name: "财务审批" }),
      node({ id: 31, round: 3, status: "in_progress", node_name: "财务审批" })
    ],
    tasks: [
      task({
        id: 2,
        node_instance_id: 21,
        round: 2,
        assignee_userid: "u2",
        action: "return_initiator",
        comment: "补充详细说明再报",
        status: "completed"
      })
    ]
  } as unknown as Partial<ApprovalDetailResponse> & { status: string });

  it("退回的轮次写退回人和原因；撤回的轮次写撤回；当前轮不写", () => {
    const notes = buildRoundNotes(roundDetail, toLabel);
    expect(notes[1]).toBe("发起人撤回后重新提交");
    expect(notes[2]).toBe("财务审批 用户u2 退回：补充详细说明再报");
    expect(notes[3]).toBeUndefined();
  });

  it("AI 拦截退回写 AI 审查", () => {
    const notes = buildRoundNotes(
      detail({
        status: "in_progress",
        instance: { status: "in_progress", current_round: 2 },
        nodes: [
          node({
            id: 11,
            round: 1,
            status: "returned",
            node_type: "ai_gate",
            node_name: "AI关卡"
          }),
          node({ id: 21, round: 2, status: "in_progress" })
        ],
        tasks: [
          task({
            node_instance_id: 11,
            round: 1,
            assignee_userid: "AI_GATE",
            action: "reject",
            comment: "AI审查不通过：金额不符",
            status: "completed"
          })
        ]
      } as unknown as Partial<ApprovalDetailResponse> & { status: string }),
      toLabel
    );
    expect(notes[1]).toBe("AI关卡 AI 审查 退回：金额不符");
  });

  it("退回时没写意见也要说清楚", () => {
    const notes = buildRoundNotes(
      detail({
        status: "in_progress",
        instance: { status: "in_progress", current_round: 2 },
        nodes: [
          node({ id: 11, round: 1, status: "returned" }),
          node({ id: 21, round: 2, status: "in_progress" })
        ],
        tasks: [
          task({
            node_instance_id: 11,
            round: 1,
            action: "return_initiator",
            status: "completed"
          })
        ]
      } as unknown as Partial<ApprovalDetailResponse> & { status: string }),
      toLabel
    );
    expect(notes[1]).toBe("财务审批 用户u1 退回：未留意见");
  });
});
