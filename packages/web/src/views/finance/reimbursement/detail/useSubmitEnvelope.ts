import { ElMessageBox } from "element-plus";
import { ref, type ComputedRef, type Ref } from "vue";

import {
  submitReimbursementEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import { resolveApiErrorMessage, type ApiErrorShape } from "./api-error";
import type { EnvelopeForm } from "./view-model";

const SUBMITTABLE_STATUSES = new Set(["draft", "submitted", "unregistered"]);

const createSubmitKey = () => `reimbursement-submit-${crypto.randomUUID()}`;

/** 提交和重新提交。查重要当场问「是否坚持提交」，流程和旧页面相同。 */
export const useSubmitEnvelope = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  form: Ref<EnvelopeForm>;
  canEdit: ComputedRef<boolean>;
  persistForm: () => Promise<void>;
  load: () => Promise<void>;
  notifyChanged: () => void;
}) => {
  const { detail, form } = deps;
  const submitting = ref(false);

  const afterSubmitted = async (text: string, type: "success" | "warning") => {
    message(text, { type });
    await deps.load();
    deps.notifyChanged();
  };

  const confirmForceSubmit = async (error: ApiErrorShape): Promise<boolean> => {
    const duplicateData = error.response?.data?.data;
    const rawChecks = duplicateData?.duplicate_checks;
    const duplicateChecks = Array.isArray(rawChecks) ? rawChecks : [];
    const duplicateTotal = Number(
      duplicateData?.duplicate_total ?? duplicateData?.duplicate_count ?? 0
    );
    const highRiskCount = duplicateChecks.filter(
      check => check?.risk_level === "high"
    ).length;
    const lines = [
      duplicateTotal > 0
        ? highRiskCount > 0
          ? `发现 ${duplicateTotal} 条疑似重复（含高风险 ${highRiskCount} 条）`
          : `发现 ${duplicateTotal} 条疑似重复记录`
        : "系统提示该报销疑似重复"
    ];
    const firstSummary = duplicateChecks[0]?.summary;
    if (firstSummary) lines.push(`如：${firstSummary}`);
    lines.push(
      "确认不是重复报销才可坚持提交；该确认将留痕并由办公室复核，属实重复将被驳回。"
    );
    try {
      await ElMessageBox.confirm(lines.join("\n"), "疑似重复报销", {
        confirmButtonText: "坚持提交",
        cancelButtonText: "返回检查",
        type: "warning"
      });
      return true;
    } catch {
      message("已取消，可核对标出的发票后再提交", { type: "info" });
      return false;
    }
  };

  const submitEnvelope = async () => {
    if (!detail.value || submitting.value) return;
    if (!SUBMITTABLE_STATUSES.has(detail.value.status)) {
      message("当前状态不允许提交报销", { type: "warning" });
      return;
    }
    if (!(Number(form.value.amount) > 0)) {
      message("请填写报销金额", { type: "warning" });
      return;
    }
    submitting.value = true;
    try {
      // 提交前自动保存，默认带出的金额也在这里写回去
      if (deps.canEdit.value) await deps.persistForm();
      const result = await submitReimbursementEnvelope(
        detail.value.id,
        undefined,
        {
          idempotencyKey: createSubmitKey()
        }
      );
      await afterSubmitted(
        result.data.resubmitted
          ? "已重新提交，办公室会再次处理"
          : "报销已提交，等办公室核查",
        "success"
      );
    } catch (error) {
      const err = error as ApiErrorShape;
      const requireForce =
        err.response?.status === 409 &&
        err.response?.data?.data?.require_force_submit === true;
      if (!requireForce) {
        message(resolveApiErrorMessage(error, "提交失败，请稍后重试"), {
          type: "error"
        });
        return;
      }
      await deps.load();
      if (!(await confirmForceSubmit(err)) || !detail.value) return;
      try {
        await submitReimbursementEnvelope(
          detail.value.id,
          {
            force_submit: true,
            force_submit_reason: "申请人在网页确认非重复并坚持提交"
          },
          { idempotencyKey: createSubmitKey() }
        );
        await afterSubmitted("已坚持提交，办公室将重点复核", "warning");
      } catch (forceError) {
        message(resolveApiErrorMessage(forceError, "提交失败，请稍后重试"), {
          type: "error"
        });
      }
    } finally {
      submitting.value = false;
    }
  };

  return { submitting, submitEnvelope };
};
