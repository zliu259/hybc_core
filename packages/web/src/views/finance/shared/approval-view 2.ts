import type { ApprovalDetailResponse } from "@/api/approval";

/** 审批进行中时当前卡在哪个节点；其余状态返回空串。 */
export const waitingNodeName = (
  approval: ApprovalDetailResponse | null
): string => {
  if (approval?.instance.status !== "in_progress") return "";
  const { current_node_key: key, current_round: round } = approval.instance;
  return (
    approval.nodes.find(node => node.node_key === key && node.round === round)
      ?.node_name ?? ""
  );
};
