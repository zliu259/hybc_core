import { ElMessageBox } from "element-plus";
import { h, ref, type Ref } from "vue";

import {
  deleteEnvelopeAttachment,
  rerecognizeAttachment,
  type AttachmentReviewView,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import { resolveApiErrorMessage } from "./api-error";
import {
  needsRemovalReason,
  previewAttachmentRemoval,
  removalPreviewText,
  removalSuccessText
} from "./attachment-removal";
import { hasBlockingDuplicate } from "./view-model";

const MAX_REASON_LENGTH = 200;

/** 确认框正文：删哪张，报销金额会怎么变。文件名按文本渲染，不拼 HTML。 */
const removalMessage = (name: string, amountLine: string | null) =>
  h("div", [
    h("p", `删除「${name}」？`),
    amountLine
      ? h("p", { style: "margin-top: 6px; color: #5c667a" }, amountLine)
      : null
  ]);

/** 弹确认框；提交后的单要填原因（选填）。取消时返回 null。 */
const confirmRemoval = async (
  view: AttachmentReviewView,
  detail: ReimbursementEnvelopeDetail
): Promise<{ reason?: string } | null> => {
  const amountLine = removalPreviewText(
    previewAttachmentRemoval(view, detail.amount ?? 0)
  );
  const body = removalMessage(view.display_name, amountLine);
  try {
    if (!needsRemovalReason(detail.status)) {
      await ElMessageBox.confirm(body, "删除附件", {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning"
      });
      return {};
    }
    const result = await ElMessageBox.prompt(body, "删除发票", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning",
      inputPlaceholder: "删除原因（选填），会记录下来",
      inputValue: hasBlockingDuplicate(view) ? "重复发票" : "",
      inputValidator: value =>
        (value ?? "").trim().length <= MAX_REASON_LENGTH ||
        `原因不能超过 ${MAX_REASON_LENGTH} 字`
    });
    const reason = typeof result === "object" ? result.value.trim() : "";
    return reason ? { reason } : {};
  } catch {
    return null;
  }
};

/** 单个附件的重新识别和删除。 */
export const useAttachmentActions = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  load: () => Promise<void>;
  notifyChanged: () => void;
}) => {
  const { detail } = deps;
  const rerecognizing = ref(false);
  const removing = ref(false);

  const rerecognize = async (attachmentIds: number[]) => {
    if (!detail.value || rerecognizing.value || attachmentIds.length === 0)
      return;
    rerecognizing.value = true;
    const envelopeId = detail.value.id;
    try {
      const results = await Promise.allSettled(
        attachmentIds.map(id => rerecognizeAttachment(envelopeId, id))
      );
      const failed = results.filter(item => item.status === "rejected").length;
      if (failed > 0) {
        message(`${failed} 张没能开始重新识别，请稍后重试`, { type: "error" });
      } else {
        message("已重新识别", { type: "success" });
      }
      await deps.load();
    } finally {
      rerecognizing.value = false;
    }
  };

  const removeAttachment = async (view: AttachmentReviewView) => {
    const current = detail.value;
    if (!current || removing.value) return;
    const payload = await confirmRemoval(view, current);
    if (!payload) return;
    removing.value = true;
    try {
      const result = await deleteEnvelopeAttachment(
        current.id,
        view.attachment_id,
        payload
      );
      message(removalSuccessText(result.data), { type: "success" });
    } catch (error) {
      message(resolveApiErrorMessage(error, "删除失败，请稍后重试"), {
        type: "error"
      });
      return;
    } finally {
      removing.value = false;
    }
    try {
      await deps.load();
    } catch {
      // 已经删掉了，刷新失败不提示删除失败；下次轮询或手动刷新会更新
    }
    deps.notifyChanged();
  };

  return { rerecognizing, removing, rerecognize, removeAttachment };
};
