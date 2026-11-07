import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { computed, ref, type ComputedRef, type Ref } from "vue";

import {
  createReimbursementEnvelope,
  rebindReimbursementEnvelopeUuid,
  scanReimbursementEnvelope,
  switchReimbursementChannel,
  triggerEnvelopeAnomalyCheck,
  updateReimbursementEnvelope,
  verifyReimbursementEnvelope,
  voidReimbursementEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import { resolveApiErrorMessage } from "./api-error";
import { usePrecheckActions } from "./usePrecheckActions";
import { useSubmitEnvelope } from "./useSubmitEnvelope";
import type { EnvelopeForm } from "./view-model";

// 详情页的操作。页面只负责把它们接到按钮上；权限判断在 useEnvelopePermissions。

const SCANNABLE_STATUSES = new Set(["draft", "submitted", "unregistered"]);

export const useEnvelopeActions = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  form: Ref<EnvelopeForm>;
  isCreate: ComputedRef<boolean>;
  envelopeId: ComputedRef<number>;
  titleEntityId: Ref<number | undefined>;
  canEdit: ComputedRef<boolean>;
  isSuperAdmin: ComputedRef<boolean>;
  isFinanceOrSuperAdmin: ComputedRef<boolean>;
  load: () => Promise<void>;
  loadFresh: () => Promise<void>;
  notifyChanged: () => void;
  onCreated: (id: number) => void;
}) => {
  const {
    detail,
    form,
    isCreate,
    envelopeId,
    titleEntityId,
    load,
    notifyChanged
  } = deps;

  const saving = ref(false);
  const scanningEnvelope = ref(false);
  const voiding = ref(false);
  const rerunningAll = ref(false);
  const verifyingAction = ref<null | "verified" | "mismatch">(null);
  const switchingChannel = ref(false);
  const savingInvoiceTitle = ref(false);

  const validateCreate = (): string | null => {
    if (!form.value.project_id) return "请选择项目";
    if (
      form.value.channel === "physical" &&
      !form.value.bind_envelope_uuid.trim()
    ) {
      return "实物信封报销必须先输入或扫描信封识别号";
    }
    return null;
  };

  /** 第一个文件传完时，或点保存时建草稿。 */
  const createDraft = async (): Promise<number> => {
    const result = await createReimbursementEnvelope(
      {
        project_id: form.value.project_id as number,
        applicant_userid: form.value.applicant_userid || undefined,
        channel: form.value.channel,
        preferred_envelope_uuid:
          form.value.channel === "physical"
            ? form.value.bind_envelope_uuid || undefined
            : undefined,
        expense_date: form.value.expense_date || undefined,
        amount: form.value.amount,
        category: form.value.category || undefined,
        description: form.value.description || undefined
      },
      { idempotencyKey: `reimbursement-create-${crypto.randomUUID()}` }
    );
    deps.onCreated(result.data.id);
    return result.data.id;
  };

  const persistForm = async () => {
    await updateReimbursementEnvelope(envelopeId.value, {
      project_id: form.value.project_id,
      applicant_userid: form.value.applicant_userid || undefined,
      expense_date: form.value.expense_date || undefined,
      amount: form.value.amount,
      category: form.value.category || undefined,
      description: form.value.description || undefined
    });
  };

  const save = async () => {
    if (saving.value) return;
    if (isCreate.value) {
      const error = validateCreate();
      if (error) {
        message(error, { type: "warning" });
        return;
      }
    } else if (!form.value.project_id) {
      message("请选择项目", { type: "warning" });
      return;
    }
    saving.value = true;
    try {
      if (isCreate.value) {
        await createDraft();
        message("已保存", { type: "success" });
        return;
      }
      await persistForm();
      message("已保存", { type: "success" });
      await deps.loadFresh();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "保存失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      saving.value = false;
    }
  };

  const { submitting, submitEnvelope } = useSubmitEnvelope({
    detail,
    form,
    canEdit: deps.canEdit,
    persistForm,
    load: deps.loadFresh,
    notifyChanged
  });

  const { precheckAction, submitPrecheck } = usePrecheckActions({
    detail,
    isFinanceOrSuperAdmin: deps.isFinanceOrSuperAdmin,
    load,
    notifyChanged
  });

  const scanSubmit = async () => {
    if (!detail.value || scanningEnvelope.value) return;
    if (!SCANNABLE_STATUSES.has(detail.value.status)) {
      message("当前状态不允许扫码登记", { type: "warning" });
      return;
    }
    scanningEnvelope.value = true;
    try {
      const result = await scanReimbursementEnvelope({
        envelope_uuid: detail.value.envelope_uuid,
        project_id: form.value.project_id,
        expense_date: form.value.expense_date || undefined,
        amount: form.value.amount,
        category: form.value.category || undefined,
        description: form.value.description || undefined
      });
      message(
        result.data.registered
          ? `扫码登记完成，已绑定填报人：${result.data.applicant_userid}`
          : "扫码识别完成，已打开已有报销信封",
        { type: result.data.registered ? "success" : "info" }
      );
      await deps.loadFresh();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "扫码登记失败"), { type: "error" });
    } finally {
      scanningEnvelope.value = false;
    }
  };

  const voidEnvelope = async (reason: string) => {
    if (!detail.value || !deps.isSuperAdmin.value || voiding.value) return;
    voiding.value = true;
    try {
      await voidReimbursementEnvelope(detail.value.id, reason);
      message("这张报销已废止", { type: "success" });
      await load();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "废止失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      voiding.value = false;
    }
  };

  const verify = async (result: "verified" | "mismatch", note?: string) => {
    if (!detail.value || verifyingAction.value) return;
    verifyingAction.value = result;
    try {
      await verifyReimbursementEnvelope({
        envelope_id: detail.value.id,
        result,
        note: note || undefined
      });
      message(result === "verified" ? "已核查签收" : "已标记核查异常", {
        type: result === "verified" ? "success" : "warning"
      });
      await load();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "操作失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      verifyingAction.value = null;
    }
  };

  const rerunAll = async () => {
    if (!detail.value || rerunningAll.value) return;
    rerunningAll.value = true;
    try {
      await triggerEnvelopeAnomalyCheck(
        detail.value.id,
        { rerun_full: true, reason: "office_manual_second_silent_review" },
        {
          idempotencyKey: `reimbursement-rerun-silent-review-${crypto.randomUUID()}`
        }
      );
      message("已开始全部重新识别", { type: "success" });
      await load();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "重新识别失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      rerunningAll.value = false;
    }
  };

  const submitRebindEnvelopeUuid = async (uuid: string, reason?: string) => {
    if (!detail.value) return;
    try {
      await rebindReimbursementEnvelopeUuid(detail.value.id, {
        envelope_uuid: uuid,
        reason: reason || "办公室人工修正错误实体信封UUID"
      });
      message("信封已换绑", { type: "success" });
      await load();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "换绑失败，请稍后重试"), {
        type: "error"
      });
    }
  };

  const onSwitchChannel = async () => {
    if (!detail.value || switchingChannel.value) return;
    const target =
      detail.value.channel === "physical" ? "electronic" : "physical";
    const targetLabel = target === "electronic" ? "电子发票" : "实物信封";
    let reason = "";
    try {
      const promptResult = (await ElMessageBox.prompt(
        `确认切换为「${targetLabel}」通道？切换后系统会重新识别全部附件。`,
        "切换报销通道",
        {
          confirmButtonText: "确认切换",
          cancelButtonText: "取消",
          inputPlaceholder: "切换原因（选填）"
        }
      )) as MessageBoxInputData;
      reason = (promptResult.value ?? "").trim();
    } catch {
      return;
    }
    switchingChannel.value = true;
    try {
      const result = await switchReimbursementChannel(detail.value.id, {
        channel: target,
        reason: reason || undefined
      });
      message(
        result.data.changed
          ? `已切换为${targetLabel}通道`
          : `通道已是${targetLabel}，无需切换`,
        { type: result.data.changed ? "success" : "info" }
      );
      await deps.loadFresh();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "通道切换失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      switchingChannel.value = false;
    }
  };

  const saveInvoiceTitle = async () => {
    if (!detail.value) return;
    savingInvoiceTitle.value = true;
    try {
      await updateReimbursementEnvelope(detail.value.id, {
        invoice_title_entity_id: titleEntityId.value ?? null
      });
      message(
        titleEntityId.value ? "发票抬头已指定" : "发票抬头已清除，回到自动识别",
        {
          type: "success"
        }
      );
      await load();
      notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "保存发票抬头失败"), {
        type: "error"
      });
    } finally {
      savingInvoiceTitle.value = false;
    }
  };

  const busy = computed(
    () =>
      saving.value ||
      submitting.value ||
      scanningEnvelope.value ||
      voiding.value ||
      rerunningAll.value ||
      switchingChannel.value ||
      verifyingAction.value !== null ||
      precheckAction.value !== null
  );

  return {
    saving,
    submitting,
    scanningEnvelope,
    voiding,
    rerunningAll,
    verifyingAction,
    precheckAction,
    switchingChannel,
    savingInvoiceTitle,
    busy,
    validateCreate,
    createDraft,
    save,
    submitEnvelope,
    submitPrecheck,
    scanSubmit,
    voidEnvelope,
    verify,
    rerunAll,
    submitRebindEnvelopeUuid,
    onSwitchChannel,
    saveInvoiceTitle
  };
};
