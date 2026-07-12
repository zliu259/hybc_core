<script setup lang="ts">
import {
  ElMessageBox,
  type MessageBoxInputData,
  type UploadRequestOptions
} from "element-plus";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature } from "@/api/upload";
import { resolveUploadUrl } from "@/api/upload";
import {
  createReimbursementEnvelope,
  getEnvelopeAnomalyStatus,
  getEnvelopeOcrStatus,
  getReimbursementEnvelope,
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
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import SplitEnvelopeDialog from "./components/SplitEnvelopeDialog.vue";
import { detectEInvoiceInPhysical } from "./reimbursement-einvoice";
import {
  attachmentTypeLabel,
  precheckActionLabel,
  reimbursementPrecheckStatusLabel as toPrecheckStatusLabel,
  reimbursementStatusLabel as toStatusLabel,
  reimbursementTaskStatusLabel as toTaskStatusLabel,
  reimbursementVerificationStatusLabel as toVerificationStatusLabel
} from "./reimbursement-labels";

defineOptions({ name: "ReimbursementDetail" });

const props = defineProps<{
  envelopeId?: number | string;
  drawerMode?: boolean;
  workspaceView?: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "changed"): void;
  (event: "created", id: number): void;
}>();

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const roleSet = computed(() => new Set(userStore.roles ?? []));
const isWorkspaceView = computed(
  () => props.workspaceView ?? route.path.startsWith("/workspace/")
);

const effectiveEnvelopeId = computed(() => props.envelopeId ?? route.params.id);
const resolvedEnvelopeId = computed(() => Number(effectiveEnvelopeId.value));
const isCreate = computed(() => effectiveEnvelopeId.value === "create");

const baseDataLoading = ref(false);
const detailLoading = ref(false);
const loading = computed(() => baseDataLoading.value || detailLoading.value);
const saving = ref(false);
const submitting = ref(false);
const detail = ref<ReimbursementEnvelopeDetail | null>(null);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const createDefaultForm = () => ({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  channel: "physical" as "physical" | "electronic",
  bind_envelope_uuid: "",
  expense_date: "",
  amount: 0,
  category: "",
  description: ""
});

const form = ref(createDefaultForm());

type EnvelopeAttachmentDraft = {
  id?: number;
  attachment_type: string;
  file_key: string;
  file_name: string;
  file_size?: number | null;
  created_at?: string;
  is_new?: boolean;
};

const attachmentItems = ref<EnvelopeAttachmentDraft[]>([]);
const uploadingAttachment = ref(false);
const attachmentType = ref("invoice");
const officeRoles = ["super_admin", "manager", "site_manager", "finance"];

const editableStatuses = new Set(["draft", "submitted"]);
const submittableStatuses = new Set(["draft", "submitted", "unregistered"]);

type ApiErrorShape = {
  message?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
      error?: string | { message?: string };
      data?: {
        require_force_submit?: boolean;
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

const hasDuplicateRisks = computed(() => {
  const checks = detail.value?.duplicate_checks ?? [];
  return checks.length > 0;
});

const uuidLocked = computed(() => {
  if (isCreate.value) return false;
  if (!detail.value) return false;
  return attachmentItems.value.length > 0 || detail.value.status !== "draft";
});

const attachmentTypeOptions = [
  { label: "发票", value: "invoice" },
  { label: "凭证", value: "receipt" },
  { label: "合同", value: "contract" },
  { label: "其他", value: "other" }
];

const riskLevelLabelMap: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险"
};

const riskLevelTagTypeMap: Record<
  string,
  "success" | "warning" | "danger" | "info"
> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toRiskLevelLabel = (level: unknown) => {
  if (typeof level !== "string" || !level) return "-";
  return riskLevelLabelMap[level] ?? level;
};

const toRiskLevelTagType = (
  level: unknown
): "success" | "warning" | "danger" | "info" => {
  if (typeof level !== "string" || !level) return "info";
  return riskLevelTagTypeMap[level] ?? "info";
};

const attachmentUrl = (fileKey: string) =>
  `/api/v1/upload/object/${encodeURIComponent(fileKey)}`;

const previewDrawerVisible = ref(false);
const previewFileUrl = ref("");
const previewFileName = ref("");
const previewInline = computed(() => {
  const lower = previewFileName.value.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".txt")
  );
});

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const previewIsImage = computed(() => {
  const lower = previewFileName.value.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
});

const parseReviewResult = (value?: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const parsedSilentReviewResult = computed(() =>
  parseReviewResult(detail.value?.silent_review_result)
);
const parsedRecognitionResult = computed(() =>
  parseReviewResult(detail.value?.ocr_result_json)
);

const normalizeDisplayText = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
};

const reviewSummaryText = computed(() => {
  const raw = parsedSilentReviewResult.value;
  if (!raw) return "-";

  const aiReasonability =
    raw.ai_reasonability && typeof raw.ai_reasonability === "object"
      ? (raw.ai_reasonability as Record<string, unknown>)
      : null;

  const topSummary =
    normalizeDisplayText(raw.ai_reasonability_summary) ||
    normalizeDisplayText(raw.summary) ||
    normalizeDisplayText(raw.comment) ||
    normalizeDisplayText(raw.output) ||
    (raw.metadata && typeof raw.metadata === "object"
      ? normalizeDisplayText((raw.metadata as Record<string, unknown>).summary)
      : "");

  const lines: string[] = [];

  const riskLabel =
    aiReasonability?.risk_level === "high"
      ? "高风险"
      : aiReasonability?.risk_level === "medium"
        ? "中风险"
        : aiReasonability?.risk_level === "low"
          ? "低风险"
          : "未标记";

  if (aiReasonability) {
    lines.push(`风险等级：${riskLabel}`);
  }

  const detailSummary = aiReasonability
    ? normalizeDisplayText(aiReasonability.summary)
    : "";
  const finalSummary = topSummary || detailSummary;
  if (finalSummary) {
    lines.push(`结论：${finalSummary}`);
  }

  const anomalies = Array.isArray(aiReasonability?.anomalies)
    ? (aiReasonability?.anomalies as Array<Record<string, unknown>>)
    : [];
  if (anomalies.length > 0) {
    lines.push("主要异常：");
    anomalies.forEach((item, index) => {
      const type = normalizeDisplayText(item.type) || "未命名异常";
      const level =
        item.level === "high"
          ? "高"
          : item.level === "medium"
            ? "中"
            : item.level === "low"
              ? "低"
              : "未标注";
      const detailText = normalizeDisplayText(item.detail);
      lines.push(
        `${index + 1}. [${level}] ${type}${detailText ? `：${detailText}` : ""}`
      );
    });
  }

  const recommendations = Array.isArray(aiReasonability?.recommendation)
    ? (aiReasonability?.recommendation as unknown[])
        .map(item => normalizeDisplayText(item))
        .filter(Boolean)
    : [];
  if (recommendations.length > 0) {
    lines.push("建议动作：");
    recommendations.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }

  if (lines.length === 0) {
    return "系统尚未生成可读摘要，请稍后刷新后重试。";
  }
  return lines.join("\n");
});

const recognitionHintRows = computed(() => {
  if (!detail.value) return [] as Array<{ label: string; value: string }>;
  return [
    {
      label: "识别发票号",
      value: detail.value.ocr_invoice_no_hint || "-"
    },
    {
      label: "识别发票唯一号",
      value: detail.value.ocr_invoice_unique_no_hint || "-"
    },
    {
      label: "识别费用日期",
      value: detail.value.ocr_expense_date_hint || "-"
    }
  ];
});

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCurrency = (value: unknown) => {
  const num = toNumberOrNull(value);
  if (num === null) return "-";
  return `${num.toFixed(2)} 元`;
};

const recognitionRawText = computed(() => {
  const raw = parsedRecognitionResult.value;
  if (!raw) return "-";

  const round = toNumberOrNull(raw.review_round);
  const failedCount = toNumberOrNull(raw.failed_count) ?? 0;
  const pendingCount = toNumberOrNull(raw.pending_count) ?? 0;
  const extractedInvoices = Array.isArray(raw.extracted_invoices)
    ? (raw.extracted_invoices as Array<Record<string, unknown>>)
    : [];

  const amountSummary =
    raw.amount_summary && typeof raw.amount_summary === "object"
      ? (raw.amount_summary as Record<string, unknown>)
      : null;

  const lines: string[] = [];
  lines.push(`审查轮次：第 ${round ?? 1} 轮`);
  lines.push(
    `票据识别：共 ${extractedInvoices.length} 张，失败 ${failedCount} 张，处理中 ${pendingCount} 张`
  );

  if (extractedInvoices.length > 0) {
    lines.push("票据明细：");
    extractedInvoices.forEach((item, index) => {
      const invoiceNo =
        (typeof item.invoice_no === "string" && item.invoice_no) ||
        (typeof item.invoice_unique_no === "string" &&
          item.invoice_unique_no) ||
        "未识别";
      const invoiceDate =
        (typeof item.invoice_date === "string" && item.invoice_date) ||
        "未识别";
      const invoiceAmount = formatCurrency(item.invoice_amount);
      const source =
        item.source === "qr_payload"
          ? "二维码"
          : item.source === "ocr_text"
            ? "OCR识别"
            : "兜底识别";
      const riskLevel =
        item.risk_level === "high"
          ? "高风险"
          : item.risk_level === "medium"
            ? "中风险"
            : item.risk_level === "low"
              ? "低风险"
              : "未标记";
      const riskHint =
        typeof item.risk_hint === "string" && item.risk_hint.trim()
          ? `；提示：${item.risk_hint.trim()}`
          : "";
      lines.push(
        `${index + 1}. 发票号：${invoiceNo}；日期：${invoiceDate}；金额：${invoiceAmount}；来源：${source}；风险：${riskLevel}${riskHint}`
      );
    });
  }

  if (amountSummary) {
    const declared = formatCurrency(amountSummary.declared_amount);
    const extracted = formatCurrency(amountSummary.extracted_total);
    const delta = formatCurrency(amountSummary.delta);
    const mismatch = amountSummary.mismatch === true;
    lines.push("金额核对：");
    lines.push(
      `申报金额 ${declared}；票据识别合计 ${extracted}；差额 ${delta}；结论：${
        mismatch ? "存在不一致，建议办公室人工复核" : "一致"
      }`
    );
  }

  return lines.join("\n");
});

const createIdempotencyKey = (scope: string) =>
  `${scope}-${crypto.randomUUID()}`;

const notifyChanged = () => {
  emit("changed");
};

const closeDetail = () => {
  if (props.drawerMode) {
    emit("close");
    return;
  }
  router.push(
    isWorkspaceView.value
      ? "/workspace/my-reimbursement"
      : "/finance/reimbursement"
  );
};

const stagedAttachmentsForSubmit = () =>
  attachmentItems.value
    .filter(item => item.is_new)
    .map(item => ({
      attachment_type: item.attachment_type || "invoice",
      file_key: item.file_key,
      file_name: item.file_name || undefined,
      file_size: item.file_size ?? undefined
    }));

const verifyNote = ref("");
const rebindEnvelopeUuid = ref("");
const voiding = ref(false);
const rerunningSilentReview = ref(false);
const ocrStatusText = ref("none");
const anomalyStatusText = ref("none");
const auditPollingTimer = ref<number | null>(null);
const auditPollingTicks = ref(0);
const AUDIT_POLL_INTERVAL_MS = 3000;
const AUDIT_POLL_MAX_TICKS = 20;

const verifyingAction = ref<null | "verified" | "mismatch">(null);
const precheckAction = ref<null | "approved" | "supplement" | "rejected">(null);
const splitDialogVisible = ref(false);
// scanningEnvelope / refreshingOcrStatus: not in the plan's literal Step 5
// snippet, added so every request-firing button in the 员工操作/办公室 groups
// carries its own loading flag and disables sibling buttons in the same
// group while in flight (project hard constraint on double-submit guards).
const scanningEnvelope = ref(false);
const refreshingOcrStatus = ref(false);

const employeeActionBusy = computed(
  () => saving.value || submitting.value || scanningEnvelope.value
);

const officeActionBusy = computed(
  () =>
    verifyingAction.value !== null ||
    precheckAction.value !== null ||
    rerunningSilentReview.value ||
    refreshingOcrStatus.value ||
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

const einvoiceDetected = computed(() =>
  detectEInvoiceInPhysical({
    channel: detail.value?.channel,
    ocrResultJson: detail.value?.ocr_result_json ?? null,
    invoiceUniqueNoHint: detail.value?.ocr_invoice_unique_no_hint ?? null
  })
);

const highestRiskLevel = computed<"high" | "medium" | "low" | "none">(() => {
  if (einvoiceDetected.value) return "high";
  const levels = (detail.value?.duplicate_checks ?? []).map(
    item => item.risk_level
  );
  if (levels.includes("high")) return "high";
  if (levels.includes("medium")) return "medium";
  if (levels.includes("low")) return "low";
  return "none";
});

const stageHint = computed(() => {
  if (isCreate.value) return "当前：新建草稿 → 下一步：保存后提交";
  const s = detail.value?.status;
  const p = detail.value?.precheck_status;
  if (s === "draft" || s === "unregistered")
    return "当前：草稿/未登记 → 下一步：完善信息并提交报销";
  if (s === "submitted") {
    if (p === "rejected")
      return "当前：复核驳回已退回 → 下一步：修改后重新提交，或由办公室拆单/废止";
    if (p === "supplement") return "当前：待补充材料 → 下一步：补充后重新提交";
    return "当前：待签收 → 下一步：办公室核查签收或标记核查异常";
  }
  if (s === "received")
    return "当前：已签收待复核 → 下一步：复核通过 / 要求补充 / 复核驳回";
  if (s === "batched") return "当前：已进入批次 → 后续在批次详情中送审";
  if (s === "pending_approval") return "当前：批次审批中";
  if (s === "approved") return "当前：审批通过，等待付款";
  if (s === "paid") return "当前：已打款，流程结束";
  if (s === "rejected") return "当前：已驳回";
  if (s === "cancelled") return "当前：已废止，不再流转";
  return "";
});

const clearAuditPolling = () => {
  if (auditPollingTimer.value) {
    window.clearInterval(auditPollingTimer.value);
    auditPollingTimer.value = null;
  }
  auditPollingTicks.value = 0;
};

const shouldPollAudit = () => {
  if (!detail.value) return false;
  const pendingStatuses = new Set(["pending", "assigned", "running"]);
  return (
    pendingStatuses.has(ocrStatusText.value) ||
    pendingStatuses.has(anomalyStatusText.value)
  );
};

const refreshAuditStatuses = async (silent = false) => {
  if (!detail.value) return;
  const [ocrResult, anomalyResult] = await Promise.all([
    getEnvelopeOcrStatus(detail.value.id),
    getEnvelopeAnomalyStatus(detail.value.id)
  ]);
  ocrStatusText.value = ocrResult.data.status || "none";
  anomalyStatusText.value = anomalyResult.data.status || "none";
  if (!silent) {
    message(
      `处理进度：发票识别 ${toTaskStatusLabel(ocrStatusText.value)} / 智能核查 ${toTaskStatusLabel(anomalyStatusText.value)}`,
      { type: "info" }
    );
  }
  await loadDetail({ showLoading: !silent });
};

const ensureAuditPolling = (reason?: string) => {
  if (!shouldPollAudit()) {
    clearAuditPolling();
    return;
  }
  if (auditPollingTimer.value) return;
  if (reason) {
    message(reason, { type: "info" });
  }
  auditPollingTicks.value = 0;
  auditPollingTimer.value = window.setInterval(async () => {
    if (!shouldPollAudit()) {
      clearAuditPolling();
      return;
    }
    auditPollingTicks.value += 1;
    try {
      await refreshAuditStatuses(true);
    } catch {
      clearAuditPolling();
      return;
    }
    if (auditPollingTicks.value >= AUDIT_POLL_MAX_TICKS) {
      clearAuditPolling();
    }
  }, AUDIT_POLL_INTERVAL_MS);
};

const loadDetail = async (options?: { showLoading?: boolean }) => {
  const showLoading = options?.showLoading ?? true;
  if (isCreate.value) {
    detail.value = null;
    form.value = createDefaultForm();
    attachmentItems.value = [];
    rebindEnvelopeUuid.value = "";
    ocrStatusText.value = "none";
    anomalyStatusText.value = "none";
    return;
  }
  if (showLoading) {
    detailLoading.value = true;
  }
  try {
    const result = await getReimbursementEnvelope(resolvedEnvelopeId.value);
    detail.value = result.data;
    form.value = {
      project_id: result.data.project_id,
      applicant_userid: result.data.applicant_userid,
      channel: result.data.channel,
      bind_envelope_uuid: "",
      expense_date: result.data.expense_date || "",
      amount: result.data.amount,
      category: result.data.category || "",
      description: result.data.description || ""
    };

    attachmentItems.value = (result.data.attachments || []).map(item => ({
      id: item.id,
      attachment_type: item.attachment_type || "invoice",
      file_key: item.file_key,
      file_name: item.file_name || item.file_key,
      file_size: item.file_size,
      created_at: item.created_at,
      is_new: false
    }));

    ocrStatusText.value = result.data.ocr_status || "none";
    anomalyStatusText.value = result.data.duplicate_check_status || "none";
    rebindEnvelopeUuid.value = "";
    ensureAuditPolling();
  } finally {
    if (showLoading) {
      detailLoading.value = false;
    }
  }
};

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
  await loadDetail();
  notifyChanged();
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
    await loadDetail();
    notifyChanged();
  } catch (error) {
    message(resolveApiErrorMessage(error, "通道切换失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    switchingChannel.value = false;
  }
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  if (!canEdit.value) {
    message("当前状态不允许上传附件", { type: "warning" });
    options.onError?.(new Error("upload_not_allowed") as never);
    return;
  }

  const rawFile = options.file;
  uploadingAttachment.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "reimbursement"
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

    attachmentItems.value.unshift({
      attachment_type: attachmentType.value,
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size,
      is_new: true
    });

    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingAttachment.value = false;
  }
};

const removeStagedAttachment = (index: number) => {
  const target = attachmentItems.value[index];
  if (!target) return;
  if (!target.is_new) {
    message("已入库附件不支持在此页面删除", { type: "info" });
    return;
  }
  attachmentItems.value.splice(index, 1);
};

const downloadAttachment = (item: EnvelopeAttachmentDraft) => {
  if (!item.file_key) return;
  const link = document.createElement("a");
  link.href = resolveUploadUrl(attachmentUrl(item.file_key));
  link.download = item.file_name || item.file_key;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const previewAttachment = (item: EnvelopeAttachmentDraft) => {
  if (!item.file_key) return;
  previewFileUrl.value = resolveUploadUrl(attachmentUrl(item.file_key));
  previewFileName.value = item.file_name || item.file_key;
  previewDrawerVisible.value = true;
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

  const attachments = stagedAttachmentsForSubmit();

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
      emit("created", result.data.id);
      notifyChanged();
      if (props.drawerMode) {
        return;
      }
      if (isWorkspaceView.value) {
        router.replace(`/workspace/my-reimbursement/detail/${result.data.id}`);
      } else {
        router.replace(`/finance/reimbursement/detail/${result.data.id}`);
      }
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
      await loadDetail();
      notifyChanged();
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
    await loadDetail();
    notifyChanged();
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
    await loadDetail();
    notifyChanged();
    ensureAuditPolling("已提交，系统正在后台静默核查并会自动刷新进度");
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
    try {
      await submitReimbursementEnvelope(
        detail.value.id,
        {
          force_submit: true,
          force_submit_reason:
            verifyNote.value || "申请人确认继续提交，办公室复核"
        },
        { idempotencyKey: createIdempotencyKey("reimbursement-submit") }
      );
      message("已按申请人坚持提交并附带审计提示，等待办公室核查", {
        type: "warning"
      });
      await loadDetail();
      notifyChanged();
      ensureAuditPolling("已提交，系统正在后台静默核查并会自动刷新进度");
    } catch (forceError) {
      message(resolveApiErrorMessage(forceError, "提交失败，请稍后重试"), {
        type: "error"
      });
    }
  } finally {
    submitting.value = false;
  }
};

const voidEnvelope = async () => {
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
    await voidReimbursementEnvelope(detail.value.id);
    message("报销提交已废止", { type: "success" });
    await loadDetail();
    notifyChanged();
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
    await loadDetail();
    notifyChanged();
  } finally {
    verifyingAction.value = null;
  }
};

const refreshOcrStatus = async () => {
  if (!detail.value || refreshingOcrStatus.value) return;
  refreshingOcrStatus.value = true;
  try {
    await refreshAuditStatuses();
    ensureAuditPolling();
  } finally {
    refreshingOcrStatus.value = false;
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
    await loadDetail();
    notifyChanged();
    ensureAuditPolling("二次静默审查已启动，系统将自动刷新进度");
  } finally {
    rerunningSilentReview.value = false;
  }
};

// handleEInvoiceBlocked is defined ahead of submitPrecheck (which calls it)
// because these are const arrow functions — unlike function declarations,
// they are not hoisted, so the caller must appear after the callee.
const handleEInvoiceBlocked = async () => {
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
    await submitPrecheck("approved", value.trim());
  } catch {
    // 用户取消
  }
};

const submitPrecheck = async (
  action: "approved" | "supplement" | "rejected",
  overrideEInvoiceReason?: string
) => {
  if (!detail.value || precheckAction.value) return;
  precheckAction.value = action;
  try {
    await precheckEnvelope(detail.value.id, {
      action,
      comment: verifyNote.value || undefined,
      override_einvoice_reason: overrideEInvoiceReason
    });
    message(`复核已更新：${precheckActionLabel(action)}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await loadDetail();
    notifyChanged();
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: {
          data?: { wait_for_audit?: boolean; einvoice_in_physical?: boolean };
        };
      };
    };
    const waitForAudit =
      err.response?.status === 409 &&
      err.response?.data?.data?.wait_for_audit === true;
    const einvoiceBlocked =
      err.response?.status === 400 &&
      err.response?.data?.data?.einvoice_in_physical === true;

    if (einvoiceBlocked) {
      // Release the busy guard before awaiting the override retry: this
      // outer call's `finally` hasn't run yet (we're still inside its own
      // catch), so without this reset, `handleEInvoiceBlocked`'s recursive
      // `submitPrecheck("approved", reason)` call would see
      // `precheckAction.value` still truthy and return immediately without
      // ever sending the forced-override request. (Caught plan defect —
      // the literal snippet silently no-ops the finance override retry.)
      precheckAction.value = null;
      await handleEInvoiceBlocked();
      return;
    }
    if (!waitForAudit) throw error;
    message("后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过", {
      type: "warning"
    });
    await loadDetail();
    notifyChanged();
    ensureAuditPolling("审计任务处理中，系统将自动刷新状态");
  } finally {
    precheckAction.value = null;
  }
};

onMounted(async () => {
  baseDataLoading.value = true;
  try {
    await Promise.all([loadProjects(), loadWecomUsers()]);
    await loadDetail();
  } finally {
    baseDataLoading.value = false;
  }
});

onBeforeUnmount(() => {
  clearAuditPolling();
});

// The split dialog's attachment table snapshots `detail.attachments` when it
// opens (see SplitEnvelopeDialog.vue). Background audit-status polling still
// replaces `detail` with a new object every few seconds while the dialog is
// open, which would otherwise keep re-triggering downstream reactivity for
// no benefit to the user mid-edit. Pausing the poll while the dialog is open
// avoids that churn; closing the dialog resumes polling if still needed.
watch(
  () => splitDialogVisible.value,
  value => {
    if (value) {
      clearAuditPolling();
    } else {
      ensureAuditPolling();
    }
  }
);

watch(
  () => effectiveEnvelopeId.value,
  async () => {
    clearAuditPolling();
    previewDrawerVisible.value = false;
    await loadDetail();
  }
);

watch(
  () => form.value.channel,
  channel => {
    if (channel === "electronic") {
      form.value.bind_envelope_uuid = "";
    }
  }
);
</script>

<template>
  <el-card
    v-loading="loading"
    element-loading-text="正在加载报销详情…"
    shadow="never"
    class="reimbursement-detail-page"
    style="background: #fffaf2"
  >
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>{{
          isCreate ? "新建报销" : `报销详情 - ${detail?.envelope_no || ""}`
        }}</span>
        <el-button @click="closeDetail">{{
          props.drawerMode ? "关闭" : "返回"
        }}</el-button>
      </div>
    </template>

    <div class="detail-summary-grid">
      <div class="summary-tile">
        <span>当前状态</span>
        <strong>{{ toStatusLabel(detail?.status) }}</strong>
      </div>
      <div class="summary-tile">
        <span>报销金额</span>
        <strong>¥{{ Number(form.amount || 0).toFixed(2) }}</strong>
      </div>
      <div class="summary-tile">
        <span>报销通道</span>
        <strong>{{
          form.channel === "physical" ? "实物信封" : "电子发票"
        }}</strong>
      </div>
      <div class="summary-tile">
        <span>后台核查</span>
        <strong>{{ toTaskStatusLabel(anomalyStatusText) }}</strong>
      </div>
    </div>

    <el-card
      v-if="detail && canSeeOfficeReview"
      shadow="never"
      class="review-card mt-3"
      :class="`review-card--${highestRiskLevel}`"
    >
      <template #header>智能核查与风险提示</template>
      <el-alert
        v-if="einvoiceDetected"
        type="error"
        :closable="false"
        title="检测到电子发票混入实物信封：复核通过将被拦截。请复核驳回并引导员工改用电子发票通道提交。"
        style="margin-bottom: 12px"
      />
      <el-descriptions :column="1" border>
        <el-descriptions-item
          v-for="item in recognitionHintRows"
          :key="item.label"
          :label="item.label"
        >
          {{ item.value }}
        </el-descriptions-item>
        <el-descriptions-item label="智能核查摘要">
          <pre class="review-pre">{{ reviewSummaryText }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="识别结果（可读版）">
          <pre class="review-pre">{{ recognitionRawText }}</pre>
        </el-descriptions-item>
      </el-descriptions>

      <el-table
        v-if="detail.duplicate_checks.length > 0"
        :data="detail.duplicate_checks"
        style="margin-top: 12px"
        size="small"
      >
        <el-table-column prop="match_type" label="匹配类型" width="120" />
        <el-table-column prop="risk_level" label="风险等级" width="120">
          <template #default="scope">
            <el-tag
              :type="toRiskLevelTagType(scope.row.risk_level)"
              size="small"
            >
              {{ toRiskLevelLabel(scope.row.risk_level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="matched_invoice_no"
          label="匹配发票号"
          width="200"
        />
        <el-table-column prop="summary" label="说明" min-width="240" />
      </el-table>
    </el-card>

    <el-alert
      v-else-if="detail && einvoiceDetected"
      type="warning"
      :closable="false"
      title="检测到您上传的是电子发票（数电票）：实物信封通道不接受电子发票，请改用电子发票通道重新提交。"
      class="mt-3"
    />

    <el-row :gutter="16">
      <el-col :xs="24" :md="16">
        <el-card shadow="never" header="基础信息">
          <el-form label-width="100px">
            <el-form-item label="所属项目" required>
              <el-select
                v-model="form.project_id"
                filterable
                placeholder="请选择项目"
                style="width: 320px"
                :disabled="!canEdit"
              >
                <el-option
                  v-for="item in projects"
                  :key="item.id"
                  :label="item.project_name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="填报人">
              <el-select
                v-model="form.applicant_userid"
                clearable
                filterable
                placeholder="留空默认当前登录人"
                style="width: 360px"
                :disabled="!canEdit"
              >
                <el-option
                  v-for="item in wecomUsers"
                  :key="item.userid"
                  :label="`${item.name} (${item.userid})`"
                  :value="item.userid"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="通道">
              <el-select
                v-model="form.channel"
                style="width: 200px"
                :disabled="!isCreate"
              >
                <el-option label="实物信封" value="physical" />
                <el-option label="电子发票" value="electronic" />
              </el-select>
              <el-button
                v-if="canSwitchChannel"
                type="warning"
                plain
                :loading="switchingChannel"
                style="margin-left: 8px"
                @click="onSwitchChannel"
                >切换通道</el-button
              >
              <span
                v-if="!isCreate && !canSwitchChannel"
                class="channel-locked-hint"
                >通道创建后不可修改</span
              >
            </el-form-item>

            <el-form-item label="费用日期">
              <el-date-picker
                v-model="form.expense_date"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 220px"
                :disabled="!canEdit"
              />
            </el-form-item>

            <el-form-item label="金额">
              <el-input-number
                v-model="form.amount"
                :min="0"
                :precision="2"
                :step="100"
                :disabled="!canEdit"
              />
            </el-form-item>

            <el-form-item label="费用类别">
              <el-input
                v-model="form.category"
                style="width: 320px"
                :disabled="!canEdit"
              />
            </el-form-item>

            <el-form-item label="说明">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="3"
                style="width: 560px"
                :disabled="!canEdit"
              />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="8">
        <el-card shadow="never" header="信封标识">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="报销识别号">{{
              detail?.envelope_no || "保存后生成"
            }}</el-descriptions-item>
            <el-descriptions-item label="信封UUID">{{
              detail?.envelope_uuid || "保存后生成"
            }}</el-descriptions-item>
            <el-descriptions-item
              v-if="!isCreate && canRebindUuid"
              label="办公室换绑UUID"
            >
              <el-space
                direction="vertical"
                alignment="stretch"
                style="width: 100%"
              >
                <el-input
                  v-model="rebindEnvelopeUuid"
                  placeholder="输入正确的实体信封UUID"
                />
                <el-button
                  type="warning"
                  plain
                  @click="submitRebindEnvelopeUuid"
                  >确认换绑</el-button
                >
              </el-space>
            </el-descriptions-item>
            <el-descriptions-item v-if="isCreate" label="绑定现有信封UUID">
              <el-input
                v-model="form.bind_envelope_uuid"
                :disabled="form.channel === 'electronic'"
                :placeholder="
                  form.channel === 'electronic'
                    ? '电子发票通道自动生成UUID'
                    : '可选：若已持有预打印信封，可直接填UUID绑定'
                "
                style="width: 100%"
              />
            </el-descriptions-item>
            <el-descriptions-item label="UUID状态">
              <el-tag :type="uuidLocked ? 'warning' : 'success'">{{
                uuidLocked ? "已锁定" : "未锁定"
              }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="说明">
              报销识别号与信封UUID统一；可直接使用预打印离线UUID作为报销识别号
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" header="状态总览" class="mt-3">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="状态">{{
              toStatusLabel(detail?.status)
            }}</el-descriptions-item>
            <el-descriptions-item label="核对状态">{{
              toVerificationStatusLabel(detail?.verification_status)
            }}</el-descriptions-item>
            <el-descriptions-item v-if="canSeeOfficeReview" label="复核状态">{{
              toPrecheckStatusLabel(detail?.precheck_status)
            }}</el-descriptions-item>
            <el-descriptions-item label="PDF状态">{{
              toTaskStatusLabel(detail?.pdf_status)
            }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" header="附件（拖拽上传）" class="mt-3">
      <el-space wrap class="mb-3">
        <el-select
          v-model="attachmentType"
          style="width: 180px"
          :disabled="!canEdit || uploadingAttachment"
        >
          <el-option
            v-for="item in attachmentTypeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-tag type="info">仅新增附件可在保存前移除</el-tag>
      </el-space>

      <el-upload
        drag
        action="#"
        :show-file-list="false"
        :disabled="!canEdit || uploadingAttachment"
        :http-request="uploadAttachment"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
      >
        <div class="el-upload__text">拖拽文件到这里，或 <em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">
            支持 PDF / 图片，上传后将进入附件列表
          </div>
        </template>
      </el-upload>

      <el-table :data="attachmentItems" size="small" style="margin-top: 12px">
        <el-table-column label="类型" width="120">
          <template #default="scope">
            <el-tag size="small">{{
              attachmentTypeLabel(scope.row.attachment_type)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="文件名" min-width="260">
          <template #default="scope">
            <span>{{ scope.row.file_name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="120">
          <template #default="scope">{{ scope.row.file_size || "-" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.is_new ? 'success' : 'info'" size="small">
              {{ scope.row.is_new ? "待保存" : "已入库" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="previewAttachment(scope.row)"
            >
              预览
            </el-button>
            <el-button
              link
              type="primary"
              @click="downloadAttachment(scope.row)"
            >
              下载
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="!scope.row.is_new"
              @click="removeStagedAttachment(scope.$index)"
            >
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="mt-3">
      <template #header>
        <div class="action-header">
          <span>操作区</span>
          <span v-if="stageHint" class="stage-hint">{{ stageHint }}</span>
        </div>
      </template>

      <!-- 员工操作 -->
      <div
        v-if="
          isCreate ||
          (detail && submittableStatuses.has(detail.status)) ||
          canEdit
        "
        class="action-group"
      >
        <div class="action-group__title">
          员工操作
          <span class="action-group__desc">保存修改、登记信封并提交报销</span>
        </div>
        <el-space wrap>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!canEdit || employeeActionBusy"
            @click="save"
            >保存</el-button
          >
          <template v-if="!isCreate && detail">
            <el-button
              v-if="
                detail.channel === 'physical' &&
                submittableStatuses.has(detail.status)
              "
              :loading="scanningEnvelope"
              :disabled="employeeActionBusy"
              @click="scanSubmit"
              >扫码登记并绑定填报人</el-button
            >
            <el-button
              v-if="submittableStatuses.has(detail.status)"
              type="primary"
              :loading="submitting"
              :disabled="employeeActionBusy"
              @click="submitEnvelope"
            >
              {{
                detail.channel === "physical"
                  ? "提交报销并寄送实物信封"
                  : "提交电子发票报销"
              }}
            </el-button>
          </template>
        </el-space>
      </div>

      <!-- 办公室签收与复核 -->
      <div
        v-if="
          !isCreate &&
          detail &&
          canSeeOfficeReview &&
          ['submitted', 'received'].includes(detail.status)
        "
        class="action-group"
      >
        <div class="action-group__title">
          办公室签收与复核
          <span class="action-group__desc"
            >先核对实物/票据并签收；签收后进行复核或拆单</span
          >
        </div>
        <el-space wrap>
          <el-input
            v-model="verifyNote"
            style="width: 240px"
            placeholder="办公室核查备注（可选）"
          />
          <el-button
            type="success"
            :loading="verifyingAction === 'verified'"
            :disabled="officeActionBusy"
            @click="verify('verified')"
            >核查签收</el-button
          >
          <el-button
            type="warning"
            :loading="verifyingAction === 'mismatch'"
            :disabled="officeActionBusy"
            @click="verify('mismatch')"
            >核查异常</el-button
          >
          <template v-if="detail.status === 'received'">
            <el-button
              type="success"
              :loading="precheckAction === 'approved'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('approved')"
              >复核通过</el-button
            >
            <el-button
              type="warning"
              :loading="precheckAction === 'supplement'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('supplement')"
              >补充材料</el-button
            >
            <el-button
              type="danger"
              :loading="precheckAction === 'rejected'"
              :disabled="officeActionBusy"
              @click="submitPrecheck('rejected')"
              >复核驳回</el-button
            >
          </template>
          <el-button
            v-if="canSplit"
            type="warning"
            plain
            :disabled="officeActionBusy"
            @click="splitDialogVisible = true"
            >拆单</el-button
          >
          <el-button
            type="info"
            :loading="rerunningSilentReview"
            :disabled="officeActionBusy"
            @click="rerunSilentReview"
            >二次静默审查</el-button
          >
          <el-button
            v-if="detail.channel === 'electronic'"
            :loading="refreshingOcrStatus"
            :disabled="officeActionBusy"
            @click="refreshOcrStatus"
            >刷新识别状态</el-button
          >
        </el-space>
      </div>

      <!-- 管理操作 -->
      <div
        v-if="
          !isCreate &&
          detail &&
          isSuperAdmin &&
          ['draft', 'submitted', 'received', 'unregistered'].includes(
            detail.status
          )
        "
        class="action-group action-group--danger"
      >
        <div class="action-group__title">
          管理操作
          <span class="action-group__desc"
            >危险操作：废止后单据不再参与流转</span
          >
        </div>
        <el-space wrap>
          <el-button
            type="danger"
            plain
            :loading="voiding"
            @click="voidEnvelope"
          >
            废止报销提交
          </el-button>
        </el-space>
      </div>

      <el-alert
        v-if="hasDuplicateRisks"
        type="warning"
        :closable="false"
        style="margin-top: 10px"
        title="检测到疑似重复报销。若申请人坚持提交，系统会记录坚持提交标记并要求办公室复核。"
      />
    </el-card>

    <SplitEnvelopeDialog
      v-if="detail"
      v-model:visible="splitDialogVisible"
      :detail="detail"
      @done="
        async () => {
          await loadDetail();
          notifyChanged();
        }
      "
      @open-envelope="
        (id: number) => {
          if (props.drawerMode) {
            emit('close');
          }
          router.push(
            isWorkspaceView
              ? `/workspace/my-reimbursement/detail/${id}`
              : `/finance/reimbursement/detail/${id}`
          );
        }
      "
    />

    <el-descriptions v-if="detail" :column="2" border style="margin-top: 16px">
      <el-descriptions-item label="状态">{{
        toStatusLabel(detail.status)
      }}</el-descriptions-item>
      <el-descriptions-item label="核对状态">{{
        toVerificationStatusLabel(detail.verification_status)
      }}</el-descriptions-item>
      <el-descriptions-item v-if="canSeeOfficeReview" label="复核状态">{{
        toPrecheckStatusLabel(detail.precheck_status)
      }}</el-descriptions-item>
      <el-descriptions-item label="PDF状态">{{
        toTaskStatusLabel(detail.pdf_status)
      }}</el-descriptions-item>
      <el-descriptions-item label="PDF文件">{{
        detail.pdf_file_key || "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="批次">{{
        detail.batch?.batch_no || "-"
      }}</el-descriptions-item>
      <el-descriptions-item v-if="canSeeOfficeReview" label="发票识别状态">{{
        toTaskStatusLabel(ocrStatusText)
      }}</el-descriptions-item>
      <el-descriptions-item v-if="canSeeOfficeReview" label="智能核查状态">{{
        toTaskStatusLabel(anomalyStatusText)
      }}</el-descriptions-item>
    </el-descriptions>

    <el-drawer v-model="previewDrawerVisible" title="附件预览" size="70%">
      <div style="height: calc(100vh - 120px)">
        <div style="margin-bottom: 8px; color: #666">{{ previewFileName }}</div>
        <template v-if="previewIsImage">
          <el-image
            :src="previewFileUrl"
            :preview-src-list="[previewFileUrl]"
            :initial-index="0"
            preview-teleported
            fit="contain"
            style="width: 100%; height: calc(100% - 48px)"
          />
          <div style="margin-top: 8px; font-size: 12px; color: #999">
            点击图片进入全屏查看，支持滚轮缩放、旋转与拖拽
          </div>
        </template>
        <template v-else-if="previewInline">
          <iframe
            :src="previewFileUrl"
            style="width: 100%; height: 100%; border: none"
          />
        </template>
        <template v-else>
          <el-alert
            type="info"
            :closable="false"
            title="该文件类型暂不支持内嵌预览，请使用下载打开"
          />
          <div style="margin-top: 12px">
            <el-link :href="previewFileUrl" target="_blank" type="primary"
              >下载附件</el-link
            >
          </div>
        </template>
      </div>
    </el-drawer>
  </el-card>
</template>

<style scoped>
:global(.reimbursement-detail-drawer .el-drawer__body) {
  padding: 12px;
  background: #f5f7fa;
}

.detail-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-tile {
  min-height: 78px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.summary-tile span {
  font-size: 13px;
  color: #6b7280;
}

.summary-tile strong {
  display: block;
  margin-top: 8px;
  overflow: hidden;
  font-size: 20px;
  color: #111827;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-card {
  border-left: 4px solid #e5e7eb;
}
.review-card--high {
  border-left-color: #ef4444;
}
.review-card--medium {
  border-left-color: #f59e0b;
}
.review-card--low {
  border-left-color: #10b981;
}

.review-pre {
  max-height: 260px;
  margin: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.action-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.stage-hint {
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}
.action-group {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}
.action-group--danger {
  background: #fef2f2;
  border-color: #fecaca;
}
.action-group__title {
  margin-bottom: 8px;
  font-weight: 600;
  color: #1f2937;
}
.action-group__desc {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}

@media (max-width: 960px) {
  .detail-summary-grid {
    grid-template-columns: 1fr;
  }
}

.channel-locked-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
