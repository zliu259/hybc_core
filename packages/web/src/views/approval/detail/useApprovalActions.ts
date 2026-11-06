import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { ElMessageBox, type UploadRequestOptions } from "element-plus";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import {
  approveApproval,
  cancelApproval,
  forceTransferApproval,
  listPendingApprovals,
  rejectApproval,
  resubmitApproval,
  returnApproval,
  transferApproval,
  uploadApprovalAttachment,
  withdrawApproval
} from "@/api/approval";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatToken, getToken } from "@/utils/auth";
import { message } from "@/utils/message";
import type { PayoutPlan } from "./usePayoutPlan";

const PENDING_ROUTE: RouteLocationRaw = { path: "/approval/index" };

const confirmed = async (text: string, title: string, confirmText: string) => {
  try {
    await ElMessageBox.confirm(text, title, {
      type: "warning",
      confirmButtonText: confirmText,
      cancelButtonText: "再想想"
    });
    return true;
  } catch {
    return false;
  }
};

export type ReturnPayload = {
  type: "initiator" | "prev" | "to";
  target_node_key?: string;
  comment?: string;
};

/** 审批动作。处理完自动打开下一条待办，批量审批不必来回跳列表。 */
export function useApprovalActions(options: {
  instanceId: Ref<number>;
  payout: PayoutPlan;
  isSuperAdmin: ComputedRef<boolean>;
  reload: () => Promise<void>;
}) {
  const { instanceId, payout, isSuperAdmin, reload } = options;
  const route = useRoute();
  const router = useRouter();

  const comment = ref("");
  const commentError = ref("");
  const payoutEditorOpen = ref(false);
  const pendingAction = ref<string | null>(null);
  const uploading = ref(false);
  const busy = computed(() => pendingAction.value !== null);

  // 打字和点快捷意见都算已填写，报错应立即消失
  watch(comment, () => {
    commentError.value = "";
  });

  const cancelLabel = computed(() =>
    isSuperAdmin.value ? "终止流程" : "取消审批"
  );

  const run = async (
    key: string,
    action: () => Promise<void>,
    failText: string
  ): Promise<boolean> => {
    pendingAction.value = key;
    try {
      await action();
      return true;
    } catch (error) {
      message(resolveApiErrorMessage(error, failText), { type: "error" });
      return false;
    } finally {
      pendingAction.value = null;
    }
  };

  const goToNextPending = async (doneText: string) => {
    comment.value = "";
    commentError.value = "";
    payoutEditorOpen.value = false;
    if (route.query.from === "monitor") {
      message(doneText, { type: "success" });
      await router.push({ path: "/approval/admin-monitor" });
      return;
    }
    try {
      const pending = await listPendingApprovals({ page: 1, pageSize: 5 });
      const next = pending.data.find(item => item.id !== instanceId.value);
      if (next) {
        message(`${doneText}，已打开下一条待办`, { type: "success" });
        await router.replace(`/approval/detail/${next.id}?from=desk`);
        return;
      }
    } catch {
      // 取不到下一条不影响本次结果，回列表即可
    }
    message(`${doneText}，待办已全部处理`, { type: "success" });
    await router.push(PENDING_ROUTE);
  };

  const approve = async () => {
    commentError.value = "";
    if (payout.visible.value && !payout.hasSelection.value) {
      payoutEditorOpen.value = true;
      message("请先选择支付方式或付款主体账户", { type: "warning" });
      return;
    }
    if (!(await payout.confirmTitleMismatch())) return;
    await run(
      "approve",
      async () => {
        if (payout.visible.value && payout.dirty.value) await payout.persist();
        await approveApproval(instanceId.value, {
          comment: comment.value.trim() || "同意"
        });
        await goToNextPending("已通过");
      },
      "审批通过失败，请重试"
    );
  };

  const reject = async () => {
    const reason = comment.value.trim();
    if (!reason) {
      commentError.value = "驳回需要写明原因";
      return;
    }
    commentError.value = "";
    const ok = await confirmed(
      "驳回后流程结束，发起人需要重新发起申请。",
      "确定驳回这笔审批？",
      "确定驳回"
    );
    if (!ok) return;
    await run(
      "reject",
      async () => {
        await rejectApproval(instanceId.value, { comment: reason });
        await goToNextPending("已驳回");
      },
      "驳回失败，请重试"
    );
  };

  const submitReturn = (payload: ReturnPayload) =>
    run(
      "return",
      async () => {
        await returnApproval(instanceId.value, payload);
        await goToNextPending("已退回");
      },
      "退回失败，请重试"
    );

  const submitTransfer = (toUserid: string, reason: string) =>
    run(
      "transfer",
      async () => {
        await transferApproval(instanceId.value, {
          to_userid: toUserid,
          reason
        });
        await goToNextPending("已转办");
      },
      "转办失败，请重试"
    );

  const submitForceTransfer = (
    taskId: number,
    toUserid: string,
    reason: string
  ) =>
    run(
      "force_transfer",
      async () => {
        await forceTransferApproval(instanceId.value, {
          task_id: taskId,
          to_userid: toUserid,
          reason
        });
        message("已改派审批人", { type: "success" });
        await reload();
      },
      "改派失败，请重试"
    );

  const withdraw = async () => {
    const ok = await confirmed(
      "撤回后这笔审批不再继续流转。",
      "确定撤回？",
      "确定撤回"
    );
    if (!ok) return;
    await run(
      "withdraw",
      async () => {
        await withdrawApproval(instanceId.value);
        message("已撤回", { type: "success" });
        await reload();
      },
      "撤回失败，请重试"
    );
  };

  const cancel = async () => {
    const ok = await confirmed(
      "流程会立即结束，且不能恢复。",
      `确定${cancelLabel.value}？`,
      `确定${cancelLabel.value}`
    );
    if (!ok) return;
    await run(
      "cancel",
      async () => {
        await cancelApproval(instanceId.value);
        message(`已${cancelLabel.value}`, { type: "success" });
        await reload();
      },
      `${cancelLabel.value}失败，请重试`
    );
  };

  const resubmit = () =>
    run(
      "resubmit",
      async () => {
        await resubmitApproval(instanceId.value);
        message("已重新提交", { type: "success" });
        await reload();
      },
      "重新提交失败，请重试"
    );

  const savePayout = async () => {
    if (!payout.hasSelection.value) {
      message("请至少选择支付方式或付款主体账户", { type: "warning" });
      return;
    }
    if (!(await payout.confirmTitleMismatch())) return;
    await run(
      "save_payout",
      async () => {
        await payout.persist();
        payoutEditorOpen.value = false;
        message("支付方案已保存", { type: "success" });
        await reload();
      },
      "保存支付方案失败，请重试"
    );
  };

  const setComment = (text: string) => {
    comment.value = text;
  };

  const togglePayoutEditor = () => {
    payoutEditorOpen.value = !payoutEditorOpen.value;
  };

  const uploadAttachment = async (request: UploadRequestOptions) => {
    const rawFile = request.file;
    uploading.value = true;
    try {
      const signRes = await createUploadSignature({
        fileName: rawFile.name,
        contentType: rawFile.type,
        category: "approval"
      });
      const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
        method: "PUT",
        headers: {
          "content-type": rawFile.type || "application/octet-stream",
          Authorization: formatToken(getToken().accessToken)
        },
        body: rawFile
      });
      if (!uploadResp.ok) {
        throw new Error(`upload_failed_${uploadResp.status}`);
      }
      await uploadApprovalAttachment(instanceId.value, {
        file_key: signRes.data.key,
        file_name: rawFile.name,
        file_size: rawFile.size
      });
      message(`已上传 ${rawFile.name}`, { type: "success" });
      request.onSuccess?.({});
      await reload();
    } catch (error) {
      message(resolveApiErrorMessage(error, "附件上传失败，请重试"), {
        type: "error"
      });
      request.onError?.(new Error("upload_failed") as never);
    } finally {
      uploading.value = false;
    }
  };

  return {
    comment,
    commentError,
    payoutEditorOpen,
    pendingAction,
    busy,
    uploading,
    cancelLabel,
    approve,
    reject,
    submitReturn,
    submitTransfer,
    submitForceTransfer,
    withdraw,
    cancel,
    resubmit,
    savePayout,
    setComment,
    togglePayoutEditor,
    uploadAttachment
  };
}

export type ApprovalActions = ReturnType<typeof useApprovalActions>;
