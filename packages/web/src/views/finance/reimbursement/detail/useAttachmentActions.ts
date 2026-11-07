import { ElMessageBox } from "element-plus";
import { ref, type Ref } from "vue";

import {
  deleteEnvelopeAttachment,
  rerecognizeAttachment,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import { resolveApiErrorMessage } from "./api-error";

/** 单个附件的重新识别和删除。 */
export const useAttachmentActions = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  load: () => Promise<void>;
  notifyChanged: () => void;
}) => {
  const { detail } = deps;
  const rerecognizing = ref(false);

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

  const removeAttachment = async (attachmentId: number, name: string) => {
    if (!detail.value) return;
    try {
      await ElMessageBox.confirm(`删除「${name}」？`, "删除附件", {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning"
      });
    } catch {
      return;
    }
    try {
      await deleteEnvelopeAttachment(detail.value.id, attachmentId);
      message("已删除", { type: "success" });
      await deps.load();
      deps.notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "删除失败，请稍后重试"), {
        type: "error"
      });
    }
  };

  return { rerecognizing, rerecognize, removeAttachment };
};
