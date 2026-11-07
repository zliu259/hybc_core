import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { computed, ref, type ComputedRef, type Ref } from "vue";

import {
  createReimbursementEnvelope,
  precheckEnvelope,
  rebindReimbursementEnvelopeUuid,
  scanReimbursementEnvelope,
  submitReimbursementEnvelope,
  switchReimbursementChannel,
  triggerEnvelopeAnomalyCheck,
  updateReimbursementEnvelope,
  verifyReimbursementEnvelope,
  voidReimbursementEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { useUserStoreHook } from "@/store/modules/user";
import { message } from "@/utils/message";
import { precheckActionLabel } from "../reimbursement-labels";

// 报销详情页的操作和权限判断。函数体从 detail.vue 原样搬过来，页面只负责把它们接到按钮上。

export type EnvelopeForm = {
  project_id: number | undefined;
  applicant_userid: string;
  channel: "physical" | "electronic";
  bind_envelope_uuid: string;
  expense_date: string;
  amount: number;
  category: string;
  description: string;
};

export type EnvelopeActionDeps = {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  form: Ref<EnvelopeForm>;
  isCreate: ComputedRef<boolean>;
  resolvedEnvelopeId: ComputedRef<number>;
  isWorkspaceView: ComputedRef<boolean>;
  entityNameById: ComputedRef<Map<number, string>>;
  titleEntityId: Ref<number | undefined>;
  verifyNote: Ref<string>;
  rebindEnvelopeUuid: Ref<string>;
  stagedAttachments: () => {
    attachment_type?: string;
    file_key: string;
    file_name?: string;
    file_size?: number;
  }[];
  loadDetail: (options?: { showLoading?: boolean }) => Promise<void>;
  notifyChanged: () => void;
  ensureAuditPolling: (reason?: string) => void;
  onCreated: (id: number) => void;
};

const officeRoles = ["super_admin", "manager", "site_manager", "finance"];
const editableStatuses = new Set(["draft", "submitted"]);
const submittableStatuses = new Set(["draft", "submitted", "unregistered"]);

export const useEnvelopeActions = (deps: EnvelopeActionDeps) => {
  const {
    detail,
    form,
    isCreate,
    resolvedEnvelopeId,
    isWorkspaceView,
    entityNameById,
    titleEntityId,
    verifyNote,
    rebindEnvelopeUuid
  } = deps;
  const userStore = useUserStoreHook();
  const roleSet = computed(() => new Set(userStore.roles ?? []));

  const saving = ref(false);
  const submitting = ref(false);

  type ApiErrorShape = {
    message?: string;
    response?: {
      status?: number;
      data?: {
        message?: string;
        error?: string | { message?: string };
        data?: {
          require_force_submit?: boolean;
          duplicate_count?: number;
          duplicate_total?: number;
          duplicate_checks?: Array<{
            risk_level?: string;
            summary?: string;
          } | null>;
        };
      };
    };
  };

  const resolveApiErrorMessage = (error: unknown, fallback: string) => {
    const err = error as ApiErrorShape;
    const rawError = err.response?.data?.error;
    const backendMessage =
      err.response?.data?.message ||
      (typeof rawError === "string" ? rawError : rawError?.message) ||
      err.message;
    return typeof backendMessage === "string" && backendMessage.trim()
      ? backendMessage
      : fallback;
  };

  const canEdit = computed(() => {
    if (isCreate.value) return true;
    if (!detail.value) return false;
    if (editableStatuses.has(detail.value.status)) return true;
    const roles = new Set(userStore.roles ?? []);
    const hasOfficeRole = officeRoles.some(role => roles.has(role));
    const canSelfAudit = roles.has("super_admin") || roles.has("finance");
    const currentUserId = String(userStore.username || "").trim();
    const applicantId = String(
      detail.value?.applicant_userid || form.value.applicant_userid || ""
    ).trim();
    const isApplicant = Boolean(
      currentUserId && applicantId && currentUserId === applicantId
    );
    return (
      hasOfficeRole &&
      ["submitted", "received"].includes(detail.value.status) &&
      (!isApplicant || canSelfAudit)
    );
  });

  const canOfficeAudit = computed(() => {
    const roles = new Set(userStore.roles ?? []);
    const hasOfficeRole = officeRoles.some(role => roles.has(role));
    const canSelfAudit = roles.has("super_admin") || roles.has("finance");
    const currentUserId = String(userStore.username || "").trim();
    const applicantId = String(
      detail.value?.applicant_userid || form.value.applicant_userid || ""
    ).trim();
    const isApplicant = Boolean(
      currentUserId && applicantId && currentUserId === applicantId
    );
    return hasOfficeRole && (!isApplicant || canSelfAudit);
  });

  const canSeeOfficeReview = computed(
    () => canOfficeAudit.value && !isWorkspaceView.value
  );

  const isSuperAdmin = computed(() => roleSet.value.has("super_admin"));

  const savingInvoiceTitle = ref(false);

  const titleLockedStatuses = new Set([
    "batched",
    "pending_approval",
    "approved",
    "paid",
    "cancelled",
    "deleted"
  ]);

  const canEditInvoiceTitle = computed(
    () =>
      !isCreate.value &&
      canOfficeAudit.value &&
      !!detail.value &&
      !titleLockedStatuses.has(detail.value.status)
  );

  const saveInvoiceTitle = async () => {
    if (!detail.value || !canEditInvoiceTitle.value) return;
    savingInvoiceTitle.value = true;
    try {
      await updateReimbursementEnvelope(detail.value.id, {
        invoice_title_entity_id: titleEntityId.value ?? null
      });
      message(
        titleEntityId.value ? "发票抬头已指定" : "发票抬头已清除，回到自动识别",
        { type: "success" }
      );
      const nextEntityId = titleEntityId.value ?? null;
      detail.value = {
        ...detail.value,
        invoice_title_entity_id: nextEntityId,
        invoice_title_name: nextEntityId
          ? (entityNameById.value.get(nextEntityId) ?? null)
          : null,
        invoice_title_source: nextEntityId ? "manual" : null
      };
      deps.notifyChanged();
    } catch (error) {
      const shape = error as {
        response?: { data?: { error?: { message?: string } } };
      };
      message(shape.response?.data?.error?.message || "保存发票抬头失败", {
        type: "error"
      });
    } finally {
      savingInvoiceTitle.value = false;
    }
  };

  const createIdempotencyKey = (scope: string) =>
    `${scope}-${crypto.randomUUID()}`;

  const voiding = ref(false);
  const rerunningSilentReview = ref(false);

  const verifyingAction = ref<null | "verified" | "mismatch">(null);
  const precheckAction = ref<null | "approved" | "supplement" | "rejected">(
    null
  );

  const scanningEnvelope = ref(false);

  const employeeActionBusy = computed(
    () => saving.value || submitting.value || scanningEnvelope.value
  );

  const officeActionBusy = computed(
    () =>
      verifyingAction.value !== null ||
      precheckAction.value !== null ||
      rerunningSilentReview.value ||
      voiding.value
  );

  const isFinanceOrSuperAdmin = computed(
    () => roleSet.value.has("super_admin") || roleSet.value.has("finance")
  );

  const canSplit = computed(
    () =>
      !isCreate.value &&
      !!detail.value &&
      isFinanceOrSuperAdmin.value &&
      !isWorkspaceView.value &&
      ["submitted", "received"].includes(detail.value.status) &&
      !detail.value.batch_id &&
      !detail.value.approval_instance_id
  );

  const canRebindUuid = computed(() => {
    if (!detail.value) return false;
    if (!canSeeOfficeReview.value) return false;
    if (detail.value.channel !== "physical") return false;
    return ["unregistered", "draft", "submitted", "received"].includes(
      detail.value.status
    );
  });

  const submitRebindEnvelopeUuid = async () => {
    if (!detail.value || !canRebindUuid.value) return;
    const targetUuid = rebindEnvelopeUuid.value.trim();
    if (!targetUuid) {
      message("请输入新的信封UUID", { type: "warning" });
      return;
    }
    await rebindReimbursementEnvelopeUuid(detail.value.id, {
      envelope_uuid: targetUuid,
      reason: verifyNote.value || "办公室人工修正错误实体信封UUID"
    });
    message("信封UUID换绑成功", { type: "success" });
    rebindEnvelopeUuid.value = "";
    await deps.loadDetail();
    deps.notifyChanged();
  };

  // 与后端 packages/api/src/routes/reimbursement-channel-switch-policy.ts 的 switchableChannelStatuses 保持一致
  const SWITCHABLE_CHANNEL_STATUSES = new Set([
    "draft",
    "unregistered",
    "submitted"
  ]);

  const canSwitchChannel = computed(() => {
    if (isCreate.value || !detail.value) return false;
    if (!roleSet.value.has("super_admin") && !roleSet.value.has("finance")) {
      return false;
    }
    return SWITCHABLE_CHANNEL_STATUSES.has(detail.value.status);
  });

  const switchingChannel = ref(false);

  const onSwitchChannel = async () => {
    if (!detail.value || switchingChannel.value) return;
    const target =
      detail.value.channel === "physical" ? "electronic" : "physical";
    const targetLabel = target === "electronic" ? "电子发票" : "实物信封";
    let reason = "";
    try {
      const promptResult = (await ElMessageBox.prompt(
        `确认切换为「${targetLabel}」通道？切换后系统将自动重新进行 AI 核验（如有附件）。`,
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
      if (!result.data.changed) {
        message(
          result.data.ai_audit_triggered
            ? `通道已是${targetLabel}，已补触发 AI 核验`
            : `通道已是${targetLabel}，无需切换`,
          { type: "info" }
        );
      } else {
        message(
          result.data.ai_audit_triggered
            ? `已切换为${targetLabel}通道，AI 核验已自动触发`
            : `已切换为${targetLabel}通道`,
          { type: "success" }
        );
      }
      await deps.loadDetail();
      deps.notifyChanged();
    } catch (error) {
      message(resolveApiErrorMessage(error, "通道切换失败，请稍后重试"), {
        type: "error"
      });
    } finally {
      switchingChannel.value = false;
    }
  };

  const save = async () => {
    // Debounce: block re-entrant submits (double-click / Enter spam) so a single
    // intent never creates multiple draft envelopes. The backend idempotency key
    // covers transparent HTTP retries; this covers separate user-triggered calls.
    if (saving.value) return;
    if (
      isCreate.value &&
      form.value.channel === "physical" &&
      !form.value.bind_envelope_uuid.trim()
    ) {
      message("实物信封报销必须先输入或扫描信封UUID", { type: "warning" });
      return;
    }
    if (!form.value.project_id) {
      message("请选择项目", { type: "warning" });
      return;
    }

    const attachments = deps.stagedAttachments();

    saving.value = true;
    try {
      if (isCreate.value) {
        const result = await createReimbursementEnvelope(
          {
            project_id: form.value.project_id,
            applicant_userid: form.value.applicant_userid || undefined,
            channel: form.value.channel,
            preferred_envelope_uuid:
              form.value.channel === "physical"
                ? form.value.bind_envelope_uuid || undefined
                : undefined,
            expense_date: form.value.expense_date || undefined,
            amount: form.value.amount,
            category: form.value.category || undefined,
            description: form.value.description || undefined,
            attachments: attachments.length > 0 ? attachments : undefined
          },
          { idempotencyKey: createIdempotencyKey("reimbursement-create") }
        );
        message("创建成功", { type: "success" });
        deps.onCreated(result.data.id);
      } else {
        await updateReimbursementEnvelope(resolvedEnvelopeId.value, {
          project_id: form.value.project_id,
          applicant_userid: form.value.applicant_userid || undefined,
          channel: form.value.channel,
          expense_date: form.value.expense_date || undefined,
          amount: form.value.amount,
          category: form.value.category || undefined,
          description: form.value.description || undefined,
          attachments: attachments.length > 0 ? attachments : undefined
        });
        message("保存成功", { type: "success" });
        await deps.loadDetail();
        deps.notifyChanged();
      }
    } finally {
      saving.value = false;
    }
  };

  const scanSubmit = async () => {
    if (!detail.value || scanningEnvelope.value) return;
    if (!submittableStatuses.has(detail.value.status)) {
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
      if (result.data.registered) {
        message(`扫码登记完成，已绑定填报人：${result.data.applicant_userid}`, {
          type: "success"
        });
      } else {
        message("扫码识别完成，已打开已有报销信封", { type: "info" });
      }
      await deps.loadDetail();
      deps.notifyChanged();
    } finally {
      scanningEnvelope.value = false;
    }
  };

  const submitEnvelope = async () => {
    if (!detail.value) return;
    if (submitting.value) return;
    if (!submittableStatuses.has(detail.value.status)) {
      message("当前状态不允许提交报销", { type: "warning" });
      return;
    }
    submitting.value = true;
    try {
      await submitReimbursementEnvelope(detail.value.id, undefined, {
        idempotencyKey: createIdempotencyKey("reimbursement-submit")
      });
      message("报销已提交，等待办公室收件与后续核查", { type: "success" });
      await deps.loadDetail();
      deps.notifyChanged();
      deps.ensureAuditPolling("已提交，系统正在后台静默核查并会自动刷新进度");
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
      const duplicateData = err.response?.data?.data;
      const rawChecks = duplicateData?.duplicate_checks;
      const duplicateChecks = Array.isArray(rawChecks) ? rawChecks : [];
      const duplicateTotal = Number(
        duplicateData?.duplicate_total ?? duplicateData?.duplicate_count ?? 0
      );
      const highRiskCount = duplicateChecks.filter(
        check => check?.risk_level === "high"
      ).length;
      const confirmLines = [
        duplicateTotal > 0
          ? highRiskCount > 0
            ? `发现 ${duplicateTotal} 条疑似重复（含高风险 ${highRiskCount} 条）`
            : `发现 ${duplicateTotal} 条疑似重复记录`
          : "系统提示该报销疑似重复"
      ];
      const firstDuplicateSummary = duplicateChecks[0]?.summary;
      if (firstDuplicateSummary) {
        confirmLines.push(`如：${firstDuplicateSummary}`);
      }
      confirmLines.push(
        "确认不是重复报销才可坚持提交；该确认将留痕并由办公室复核，属实重复将被驳回。"
      );
      try {
        await ElMessageBox.confirm(confirmLines.join("\n"), "疑似重复报销", {
          confirmButtonText: "坚持提交",
          cancelButtonText: "返回检查",
          type: "warning"
        });
      } catch {
        message("已取消，可在下方查重明细核对后再提交", { type: "info" });
        return;
      }
      try {
        await submitReimbursementEnvelope(
          detail.value.id,
          {
            force_submit: true,
            force_submit_reason:
              verifyNote.value || "申请人在网页确认非重复并坚持提交"
          },
          { idempotencyKey: createIdempotencyKey("reimbursement-submit") }
        );
        message("已按申请人坚持提交并附带审计提示，等待办公室核查", {
          type: "warning"
        });
        await deps.loadDetail();
        deps.notifyChanged();
        deps.ensureAuditPolling("已提交，系统正在后台静默核查并会自动刷新进度");
      } catch (forceError) {
        message(resolveApiErrorMessage(forceError, "提交失败，请稍后重试"), {
          type: "error"
        });
      }
    } finally {
      submitting.value = false;
    }
  };

  const voidEnvelope = async (reason?: string) => {
    if (!detail.value || !isSuperAdmin.value) return;
    try {
      await ElMessageBox.confirm(
        "确认废止该报销提交？废止后该单据将不再参与后续流转。",
        "废止报销提交",
        {
          confirmButtonText: "确认废止",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    voiding.value = true;
    try {
      await voidReimbursementEnvelope(detail.value.id, reason);
      message("报销提交已废止", { type: "success" });
      await deps.loadDetail();
      deps.notifyChanged();
    } finally {
      voiding.value = false;
    }
  };

  const verify = async (result: "verified" | "mismatch") => {
    if (!detail.value || verifyingAction.value) return;
    verifyingAction.value = result;
    try {
      await verifyReimbursementEnvelope({
        envelope_id: detail.value.id,
        result,
        note: verifyNote.value || undefined
      });
      message(result === "verified" ? "收件核对通过" : "已标记核对异常", {
        type: result === "verified" ? "success" : "warning"
      });
      await deps.loadDetail();
      deps.notifyChanged();
    } finally {
      verifyingAction.value = null;
    }
  };

  const rerunSilentReview = async () => {
    if (!detail.value) return;
    rerunningSilentReview.value = true;
    try {
      await triggerEnvelopeAnomalyCheck(
        detail.value.id,
        {
          rerun_full: true,
          reason: "office_manual_second_silent_review"
        },
        {
          idempotencyKey: createIdempotencyKey(
            "reimbursement-rerun-silent-review"
          )
        }
      );
      message("已触发二次静默审查（票据识别+重复校验+费用合理性）", {
        type: "success"
      });
      await deps.loadDetail();
      deps.notifyChanged();
      deps.ensureAuditPolling("二次静默审查已启动，系统将自动刷新进度");
    } finally {
      rerunningSilentReview.value = false;
    }
  };

  // 复核通过的强制放行理由：两类拦截（重复风险 / 电子发票混入）可能先后触发，
  // 重试时必须把已收集的理由一并带上，否则会在两个弹窗之间来回循环。
  type PrecheckOverrides = {
    einvoiceReason?: string;
    duplicateReason?: string;
  };

  // handleDuplicateBlocked / handleEInvoiceBlocked are defined ahead of
  // submitPrecheck (which calls them) because these are const arrow functions —
  // unlike function declarations, they are not hoisted, so the caller must
  // appear after the callee.
  const handleDuplicateBlocked = async (overrides: PrecheckOverrides) => {
    if (!isFinanceOrSuperAdmin.value) {
      message(
        "查重发现疑似重复报销，且申请人未坚持提交，复核通过被拦截。请等待申请人坚持提交，或转交办公室财务处理。",
        { type: "error" }
      );
      return;
    }
    try {
      const { value } = (await ElMessageBox.prompt(
        "查重发现疑似重复报销，且申请人未坚持提交。如已人工核实并确认非重复报销，可填写理由放行（将记录审计日志）。",
        "重复风险拦截",
        {
          confirmButtonText: "确认放行",
          cancelButtonText: "取消",
          inputPlaceholder: "放行理由（必填）",
          inputValidator: (input: string) =>
            input.trim() ? true : "理由不能为空",
          type: "warning"
        }
      )) as MessageBoxInputData;
      await submitPrecheck("approved", {
        ...overrides,
        duplicateReason: value.trim()
      });
    } catch {
      // 用户取消
    }
  };

  const handleEInvoiceBlocked = async (overrides: PrecheckOverrides) => {
    if (!isFinanceOrSuperAdmin.value) {
      message(
        "检测到电子发票混入实物信封，复核通过被拦截。请复核驳回并引导员工走电子发票通道。",
        { type: "error" }
      );
      return;
    }
    try {
      // ElMessageBox.prompt's declared return type is
      // `MessageBoxInputData | Action` (Element Plus's own typing), where
      // `Action` ('confirm' | 'close' | 'cancel') has no `.value`. At runtime
      // the promise only ever resolves (vs. rejects) with MessageBoxInputData,
      // so this narrowing assertion is safe; destructuring `{ value }`
      // directly off the raw union does not type-check (caught plan defect —
      // the literal snippet fails `tsc --noEmit`).
      const { value } = (await ElMessageBox.prompt(
        "检测到电子发票混入实物信封。常规处置为复核驳回并让员工改走电子发票通道；如确认是识别误判，可填写理由强制通过（将记录审计日志）。",
        "电子发票混入拦截",
        {
          confirmButtonText: "强制通过",
          cancelButtonText: "取消",
          inputPlaceholder: "强制通过理由（必填）",
          inputValidator: (input: string) =>
            input.trim() ? true : "理由不能为空",
          type: "warning"
        }
      )) as MessageBoxInputData;
      await submitPrecheck("approved", {
        ...overrides,
        einvoiceReason: value.trim()
      });
    } catch {
      // 用户取消
    }
  };

  const submitPrecheck = async (
    action: "approved" | "supplement" | "rejected",
    overrides: PrecheckOverrides = {}
  ) => {
    if (!detail.value || precheckAction.value) return;
    precheckAction.value = action;
    try {
      await precheckEnvelope(detail.value.id, {
        action,
        comment: verifyNote.value || undefined,
        override_einvoice_reason: overrides.einvoiceReason,
        override_duplicate_reason: overrides.duplicateReason
      });
      message(`复核已更新：${precheckActionLabel(action)}`, {
        type: action === "approved" ? "success" : "warning"
      });
      await deps.loadDetail();
      deps.notifyChanged();
    } catch (error) {
      const err = error as {
        response?: {
          status?: number;
          data?: {
            data?: {
              wait_for_audit?: boolean;
              einvoice_in_physical?: boolean;
              duplicate_risk_unconfirmed?: boolean;
            };
          };
        };
      };
      const waitForAudit =
        err.response?.status === 409 &&
        err.response?.data?.data?.wait_for_audit === true;
      const einvoiceBlocked =
        err.response?.status === 400 &&
        err.response?.data?.data?.einvoice_in_physical === true;
      const duplicateBlocked =
        err.response?.status === 400 &&
        err.response?.data?.data?.duplicate_risk_unconfirmed === true;

      if (duplicateBlocked || einvoiceBlocked) {
        // Release the busy guard before awaiting the override retry: this
        // outer call's `finally` hasn't run yet (we're still inside its own
        // catch), so without this reset, the handler's recursive
        // `submitPrecheck("approved", overrides)` call would see
        // `precheckAction.value` still truthy and return immediately without
        // ever sending the forced-override request. (Caught plan defect —
        // the literal snippet silently no-ops the finance override retry.)
        precheckAction.value = null;
        if (duplicateBlocked) {
          await handleDuplicateBlocked(overrides);
        } else {
          await handleEInvoiceBlocked(overrides);
        }
        return;
      }
      if (!waitForAudit) throw error;
      message(
        "后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过",
        {
          type: "warning"
        }
      );
      await deps.loadDetail();
      deps.notifyChanged();
      deps.ensureAuditPolling("审计任务处理中，系统将自动刷新状态");
    } finally {
      precheckAction.value = null;
    }
  };

  return {
    canEdit,
    canOfficeAudit,
    canSeeOfficeReview,
    isSuperAdmin,
    isFinanceOrSuperAdmin,
    canSplit,
    canRebindUuid,
    canSwitchChannel,
    canEditInvoiceTitle,
    saving,
    submitting,
    scanningEnvelope,
    voiding,
    rerunningSilentReview,
    verifyingAction,
    precheckAction,
    switchingChannel,
    savingInvoiceTitle,
    employeeActionBusy,
    officeActionBusy,
    submittableStatuses,
    save,
    scanSubmit,
    submitEnvelope,
    voidEnvelope,
    verify,
    rerunSilentReview,
    submitPrecheck,
    submitRebindEnvelopeUuid,
    onSwitchChannel,
    saveInvoiceTitle
  };
};
