import type { AttachmentReviewView } from "@/api/reimbursement";
import { formatYuan } from "./view-model";

// 删发票前在确认框里说清楚报销金额会怎么变。口径和接口一致：
// 只扣识别出金额的那张，最少扣到 0；没存申报金额的草稿按票面合计显示，不用提。

export const PRE_SUBMIT_STATUSES = ["draft", "unregistered"];

export type RemovalPreview =
  | { kind: "deduct"; deducted: number; before: number; after: number }
  | { kind: "no_amount" }
  | { kind: "follows_total" };

const roundMoney = (value: number): number => Number(value.toFixed(2));

export const previewAttachmentRemoval = (
  view: AttachmentReviewView,
  storedAmount: number
): RemovalPreview => {
  if (storedAmount <= 0) return { kind: "follows_total" };
  if (view.state !== "recognized" || view.amount === null) {
    return { kind: "no_amount" };
  }
  return {
    kind: "deduct",
    deducted: view.amount,
    before: storedAmount,
    after: Math.max(0, roundMoney(storedAmount - view.amount))
  };
};

export const removalPreviewText = (preview: RemovalPreview): string | null => {
  switch (preview.kind) {
    case "deduct":
      return `报销金额会从 ${formatYuan(preview.before)} 改为 ${formatYuan(preview.after)}（减去这张的 ${formatYuan(preview.deducted)}）。`;
    case "no_amount":
      return "这张没识别出金额，报销金额不会自动改，删除后请到报销信息里核对。";
    case "follows_total":
      return null;
  }
};

/** 提交后删发票要记原因；看到疑似重复时默认填好。 */
export const needsRemovalReason = (status: string): boolean =>
  !PRE_SUBMIT_STATUSES.includes(status);

export const removalSuccessText = (result: {
  deducted_amount: number;
  amount: number;
  precheck_reset: boolean;
}): string => {
  const parts = ["已删除"];
  if (result.deducted_amount > 0) {
    parts.push(`报销金额改为 ${formatYuan(result.amount)}`);
  }
  if (result.precheck_reset) parts.push("需要重新复核");
  return parts.join("，");
};
