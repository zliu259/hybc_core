import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { ref, type ComputedRef, type Ref } from "vue";

import {
  precheckEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import { precheckActionLabel } from "../reimbursement-labels";
import type { ApiErrorShape } from "./api-error";

export type PrecheckAction = "approved" | "supplement" | "rejected";

// 复核通过的强制放行理由：两类拦截（重复风险 / 电子发票混入）可能先后触发，
// 重试时必须把已收集的理由一并带上，否则会在两个弹窗之间来回循环。
type PrecheckOverrides = {
  einvoiceReason?: string;
  duplicateReason?: string;
};

const promptReason = async (
  text: string,
  title: string,
  confirmText: string,
  placeholder: string
) => {
  const { value } = (await ElMessageBox.prompt(text, title, {
    confirmButtonText: confirmText,
    cancelButtonText: "取消",
    inputPlaceholder: placeholder,
    inputValidator: (input: string) => (input.trim() ? true : "理由不能为空"),
    type: "warning"
  })) as MessageBoxInputData;
  return value.trim();
};

export const usePrecheckActions = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  isFinanceOrSuperAdmin: ComputedRef<boolean>;
  load: () => Promise<void>;
  notifyChanged: () => void;
}) => {
  const { detail, isFinanceOrSuperAdmin } = deps;
  const precheckAction = ref<PrecheckAction | null>(null);

  const handleDuplicateBlocked = async (
    comment: string | undefined,
    overrides: PrecheckOverrides
  ) => {
    if (!isFinanceOrSuperAdmin.value) {
      message(
        "查重发现疑似重复报销，且申请人未坚持提交，复核通过被拦截。请等待申请人坚持提交，或转交办公室财务处理。",
        { type: "error" }
      );
      return;
    }
    try {
      const reason = await promptReason(
        "查重发现疑似重复报销，且申请人未坚持提交。如已人工核实并确认非重复报销，可填写理由放行（将记录审计日志）。",
        "重复风险拦截",
        "确认放行",
        "放行理由（必填）"
      );
      await submitPrecheck("approved", comment, {
        ...overrides,
        duplicateReason: reason
      });
    } catch {
      // 用户取消
    }
  };

  const handleEInvoiceBlocked = async (
    comment: string | undefined,
    overrides: PrecheckOverrides
  ) => {
    if (!isFinanceOrSuperAdmin.value) {
      message(
        "检测到电子发票混入实物信封，复核通过被拦截。请复核驳回并引导员工走电子发票通道。",
        {
          type: "error"
        }
      );
      return;
    }
    try {
      const reason = await promptReason(
        "检测到电子发票混入实物信封。常规处置为复核驳回并让员工改走电子发票通道；如确认是识别误判，可填写理由强制通过（将记录审计日志）。",
        "电子发票混入拦截",
        "强制通过",
        "强制通过理由（必填）"
      );
      await submitPrecheck("approved", comment, {
        ...overrides,
        einvoiceReason: reason
      });
    } catch {
      // 用户取消
    }
  };

  const submitPrecheck = async (
    action: PrecheckAction,
    comment?: string,
    overrides: PrecheckOverrides = {}
  ): Promise<void> => {
    if (!detail.value || precheckAction.value) return;
    precheckAction.value = action;
    try {
      await precheckEnvelope(detail.value.id, {
        action,
        comment: comment || undefined,
        override_einvoice_reason: overrides.einvoiceReason,
        override_duplicate_reason: overrides.duplicateReason
      });
      message(`复核已更新：${precheckActionLabel(action)}`, {
        type: action === "approved" ? "success" : "warning"
      });
      await deps.load();
      deps.notifyChanged();
    } catch (error) {
      const err = error as ApiErrorShape;
      const data = err.response?.data?.data;
      const waitForAudit =
        err.response?.status === 409 && data?.wait_for_audit === true;
      const einvoiceBlocked =
        err.response?.status === 400 && data?.einvoice_in_physical === true;
      const duplicateBlocked =
        err.response?.status === 400 &&
        data?.duplicate_risk_unconfirmed === true;

      if (duplicateBlocked || einvoiceBlocked) {
        // 这次调用的 finally 还没跑，不先放开的话下面重试会被开头的判断直接挡回去
        precheckAction.value = null;
        if (duplicateBlocked) {
          await handleDuplicateBlocked(comment, overrides);
        } else {
          await handleEInvoiceBlocked(comment, overrides);
        }
        return;
      }
      if (!waitForAudit) throw error;
      message("还有发票在识别，识别完才能复核通过", { type: "warning" });
      await deps.load();
      deps.notifyChanged();
    } finally {
      precheckAction.value = null;
    }
  };

  return { precheckAction, submitPrecheck };
};
