import type { ReimbursementEnvelope } from "@/api/reimbursement";

export type ReimbursementStation = {
  label: string;
  batchId: number | null;
};

/**
 * 由信封的 status / precheck_status / batch_id 派生「当前站点」,
 * 用于全流程查询回答「这单到哪了」。纯前端派生,不改后端。
 */
export const resolveStation = (
  env: Pick<ReimbursementEnvelope, "status" | "precheck_status" | "batch_id">
): ReimbursementStation => {
  const batchId = env.batch_id ?? null;
  switch (env.status) {
    case "unregistered":
    case "draft":
      return { label: "提交人手中", batchId: null };
    case "submitted":
      return { label: "待签收(办公室)", batchId: null };
    case "received":
      if (env.precheck_status === "approved") {
        return batchId
          ? { label: "审批中", batchId }
          : { label: "待成批(办公室)", batchId: null };
      }
      return { label: "待复核(办公室)", batchId: null };
    case "batched":
      // 已成批但批次尚未送审:仍在办公室手中待送审,不是「审批中」
      return { label: "待送审(办公室)", batchId };
    case "pending_approval":
      return { label: "审批中", batchId };
    case "approved":
      return { label: "待付款", batchId };
    case "paid":
      return { label: "已付款", batchId };
    case "rejected":
      return { label: "已驳回", batchId };
    case "cancelled":
      return { label: "已废弃", batchId };
    default:
      return { label: env.status, batchId };
  }
};
