/**
 * 审批流程区的显示规则。节点状态不能直接照搬库里的值：引擎把驳回节点也落成
 * completed；流程结束或进入下一轮后，没走到的节点还停在 pending、in_progress。
 */
import type { ApprovalNodeInstance, ApprovalTask } from "@/api/approval";
import { toStatusLabel } from "../labels";
import { toTaskComment } from "./ai-verdict";
import { isMeaningfulComment } from "./formatters";

export type NodeTone =
  | "success"
  | "active"
  | "warning"
  | "danger"
  | "pending"
  | "muted";

export type NodeDisplay = { label: string; tone: NodeTone };

export type InstanceState = { status: string; current_round: number };

const DECISIONS = ["approve", "reject"];

/** 最后一个决定是驳回。AI 拦截后人工放行的节点不算。 */
const isRejected = (tasks: ApprovalTask[]): boolean => {
  const decisions = tasks.filter(task => DECISIONS.includes(task.action ?? ""));
  return decisions[decisions.length - 1]?.action === "reject";
};

const isRoundClosed = (
  node: ApprovalNodeInstance,
  instance: InstanceState
): boolean =>
  instance.status !== "in_progress" || node.round < instance.current_round;

export const resolveNodeDisplay = (
  node: ApprovalNodeInstance,
  tasks: ApprovalTask[],
  instance: InstanceState
): NodeDisplay => {
  if (node.status === "returned") return { label: "已退回", tone: "warning" };
  if (node.status === "completed") {
    return isRejected(tasks)
      ? { label: "已驳回", tone: "danger" }
      : { label: "已完成", tone: "success" };
  }
  const closed = isRoundClosed(node, instance);
  if (node.status === "in_progress" || node.status === "cancelled") {
    return closed
      ? { label: "已中止", tone: "muted" }
      : { label: toStatusLabel(node.status), tone: "active" };
  }
  if (node.status === "pending") {
    return closed
      ? { label: "未执行", tone: "muted" }
      : { label: "待处理", tone: "pending" };
  }
  return { label: toStatusLabel(node.status), tone: "muted" };
};

export const isCurrentNode = (
  node: ApprovalNodeInstance,
  instance: InstanceState,
  currentNodeKey: string | null
): boolean =>
  instance.status === "in_progress" &&
  node.round === instance.current_round &&
  node.status === "in_progress" &&
  node.node_key === currentNodeKey;

/** 通过时「同意」这类字样和动作标签重复，其他动作写什么都要显示。 */
export const shouldShowTaskComment = (task: ApprovalTask): boolean => {
  if (task.assignee_userid === "AI_GATE") return Boolean(toTaskComment(task));
  if (!(task.comment ?? "").trim()) return false;
  return task.action !== "approve" || isMeaningfulComment(task.comment);
};

/** 流程结束时没轮到的人。不写的话只剩一个名字，看不出他做了什么。 */
export const taskIdleText = (task: ApprovalTask): string =>
  task.status === "cancelled" && !task.action ? "未处理" : "";

type RoundInput = {
  instance: Pick<InstanceState, "current_round">;
  nodes: ApprovalNodeInstance[];
  tasks: ApprovalTask[];
};

const describeRoundEnd = (
  nodes: ApprovalNodeInstance[],
  tasks: ApprovalTask[],
  toUserLabel: (userid: string) => string
): string => {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const inRound = tasks.filter(task => nodeById.has(task.node_instance_id));
  const returned = inRound
    .filter(task => task.action === "return_initiator")
    .pop();
  if (returned) {
    const name = nodeById.get(returned.node_instance_id)?.node_name;
    const comment = (returned.comment ?? "").trim() || "未留意见";
    return `${name} ${toUserLabel(returned.assignee_userid)} 退回：${comment}`;
  }
  const aiReturned = inRound
    .filter(
      task =>
        task.assignee_userid === "AI_GATE" &&
        task.action === "reject" &&
        nodeById.get(task.node_instance_id)?.status === "returned"
    )
    .pop();
  if (aiReturned) {
    const name = nodeById.get(aiReturned.node_instance_id)?.node_name;
    return `${name} AI 审查 退回：${toTaskComment(aiReturned) || "未留意见"}`;
  }
  return nodes.some(
    node => node.status === "in_progress" || node.status === "cancelled"
  )
    ? "发起人撤回后重新提交"
    : "这一轮没有走完";
};

/**
 * 前面每一轮是怎么结束的，键是轮次。退回或撤回后重新提交会新开一轮，同名节点再来一遍，
 * 不说明的话看不出为什么又走了一次。当前轮还没结束，不写。
 */
export const buildRoundNotes = (
  detail: RoundInput,
  toUserLabel: (userid: string) => string
): Record<number, string> =>
  Object.fromEntries(
    Array.from(
      { length: Math.max(0, detail.instance.current_round - 1) },
      (_, index) => index + 1
    ).map(round => [
      round,
      describeRoundEnd(
        detail.nodes.filter(node => node.round === round),
        detail.tasks,
        toUserLabel
      )
    ])
  );
