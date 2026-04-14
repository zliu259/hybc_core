<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { type UploadRequestOptions } from "element-plus";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { message } from "@/utils/message";
import {
  getApprovalDetail,
  approveApproval,
  rejectApproval,
  returnApproval,
  transferApproval,
  forceTransferApproval,
  withdrawApproval,
  cancelApproval,
  resubmitApproval,
  uploadApprovalAttachment,
  type ApprovalDetailResponse,
  type ApprovalTask
} from "@/api/approval";
import {
  getRiskReport,
  getPaymentRequest,
  updatePaymentRequest,
  type PaymentRequestDetail
} from "@/api/payment";
import {
  getBatchAuditReport,
  getReimbursementBatch,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";
import {
  getInvoiceRequest,
  getReceiptRefund,
  type InvoiceRequest,
  type ReceiptRefundDetail
} from "@/api/receipt";
import { getContract, type ContractDetail } from "@/api/contract";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { formatToken, getToken } from "@/utils/auth";
import { formatBeijingDateTime } from "@/utils/datetime";
import { toActionLabel, toBizTypeLabel, toStatusLabel } from "./labels";

defineOptions({ name: "ApprovalDetail" });

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const pendingApprovalRoute: RouteLocationRaw = { path: "/approval/index" };
const loading = ref(false);
const detail = ref<ApprovalDetailResponse | null>(null);
const selectedRound = ref(1);
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const instanceId = computed(() => Number(route.params.id));

const availableRounds = computed(() => {
  if (!detail.value) return [1];
  const maxRound = detail.value.instance.current_round;
  return Array.from({ length: maxRound }, (_, i) => i + 1);
});

const roundNodes = computed(() => {
  if (!detail.value) return [];
  return detail.value.nodes
    .filter(n => n.round === selectedRound.value)
    .sort((a, b) => a.sort_order - b.sort_order);
});

const aiGateReviews = computed(() => detail.value?.ai_gate_reviews ?? []);

const getNodeTasks = (nodeId: number): ApprovalTask[] => {
  if (!detail.value) return [];
  return detail.value.tasks.filter(t => t.node_instance_id === nodeId);
};

const getNodeAssignees = (assigneeUserids: string | null): string[] => {
  if (!assigneeUserids) return [];
  try {
    const parsed = JSON.parse(assigneeUserids) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

const getNodeAssigneeLabels = (assigneeUserids: string | null): string[] => {
  return getNodeAssignees(assigneeUserids).map(item => toUserLabel(item));
};

const nodeStatusColor: Record<string, string> = {
  completed: "#67c23a",
  in_progress: "#409eff",
  pending: "#909399",
  skipped: "#909399",
  returned: "#e6a23c"
};

const nodeTypeLabelMap: Record<string, string> = {
  sequential: "顺序签",
  countersign: "会签",
  or_sign: "或签",
  auto: "自动",
  cc: "抄送",
  ai_gate: "AI关卡"
};

const hasAction = (action: string) =>
  detail.value?.available_actions.includes(action) ?? false;

const commentInput = ref("");
const actionLoading = ref(false);
const uploadingApprovalAttachment = ref(false);
const cancelActionLabel = computed(() =>
  isSuperAdmin.value ? "终止流程" : "取消"
);

const canUploadInApproval = computed(() => {
  if (isSuperAdmin.value) return true;
  return (
    hasAction("approve") ||
    hasAction("reject") ||
    hasAction("return_prev") ||
    hasAction("return_to") ||
    hasAction("return_initiator")
  );
});

const returnDialogVisible = ref(false);
const returnType = ref<"initiator" | "prev" | "to">("initiator");
const returnTargetNodeKey = ref("");
const returnComment = ref("");

const transferDialogVisible = ref(false);
const transferToUserid = ref("");
const transferReason = ref("");
const forceTransferDialogVisible = ref(false);
const forceTransferTaskId = ref<number | null>(null);
const forceTransferFromUserid = ref("");
const forceTransferToUserid = ref("");
const forceTransferReason = ref("");
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const { projects, loadProjects } = useProjectOptions();
const entities = ref<Entity[]>([]);
const entityBankAccountMap = ref<Record<number, EntityBankAccount[]>>({});

const payoutForm = ref({
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined,
  payment_account: ""
});

const canAdjustPayoutInApprovalWorkbench = computed(() => {
  if (!detail.value || !paymentDetail.value) return false;
  if (detail.value.instance.biz_type !== "payment_request") return false;
  return (
    hasAction("approve") || hasAction("reject") || hasAction("return_prev")
  );
});

const payoutEntityAccounts = computed(() => {
  if (!payoutForm.value.payment_entity_id) return [];
  return (
    entityBankAccountMap.value[payoutForm.value.payment_entity_id] ?? []
  ).filter(item => item.status === "active");
});

const onPayoutEntityChange = (entityId: number | undefined) => {
  if (!entityId) {
    payoutForm.value.payment_entity_bank_account_id = undefined;
    payoutForm.value.payment_account = "";
    return;
  }
  const accounts = (entityBankAccountMap.value[entityId] ?? []).filter(
    item => item.status === "active"
  );
  if (accounts.length > 0) {
    payoutForm.value.payment_entity_bank_account_id = accounts[0].id;
    payoutForm.value.payment_account = `${accounts[0].bank_name} / ${accounts[0].account_no}`;
  } else {
    payoutForm.value.payment_entity_bank_account_id = undefined;
    payoutForm.value.payment_account = "";
  }
};

const onPayoutAccountChange = (accountId: number | undefined) => {
  if (!accountId) {
    payoutForm.value.payment_account = "";
    return;
  }
  const target = payoutEntityAccounts.value.find(item => item.id === accountId);
  payoutForm.value.payment_account = target
    ? `${target.bank_name} / ${target.account_no}`
    : "";
};

const syncPayoutSelection = async () => {
  if (!paymentDetail.value) return;
  if (!canAdjustPayoutInApprovalWorkbench.value) return;
  if (
    !payoutForm.value.payment_entity_id ||
    !payoutForm.value.payment_entity_bank_account_id
  ) {
    message("请先选择付款主体和付款账户", { type: "warning" });
    throw new Error("payout selection required");
  }
  await updatePaymentRequest(paymentDetail.value.id, {
    payment_entity_id: payoutForm.value.payment_entity_id,
    payment_entity_bank_account_id:
      payoutForm.value.payment_entity_bank_account_id,
    payment_account: payoutForm.value.payment_account || null,
    admin_edit_mode: isSuperAdmin.value ? true : undefined,
    edit_note: isSuperAdmin.value
      ? "approval workbench payout selection update"
      : undefined
  });
};

const savePayoutSelection = async () => {
  actionLoading.value = true;
  try {
    await syncPayoutSelection();
    message("付款主体与账户已保存", { type: "success" });
    await loadDetail();
  } catch {
    message("保存付款主体与账户失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

type TagType = "primary" | "success" | "warning" | "danger" | "info";
const paymentRiskStatus = ref("none");
const paymentRiskReport = ref<Record<string, unknown> | null>(null);
const reimbursementAuditStatus = ref("none");
const reimbursementAuditReport = ref<Record<string, unknown> | string | null>(
  null
);
const paymentDetail = ref<PaymentRequestDetail | null>(null);
const contractDetail = ref<ContractDetail | null>(null);
const reimbursementBatchDetail = ref<ReimbursementBatchDetail | null>(null);
const invoiceRequestDetail = ref<InvoiceRequest | null>(null);
const invoiceLinkedContract = ref<ContractDetail | null>(null);
const receiptRefundDetail = ref<ReceiptRefundDetail | null>(null);
const riskTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const riskLevelLabelMap: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险"
};

const riskLevelTagTypeMap: Record<string, TagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toInvoiceReviewRiskLabel = (value: unknown) => {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return "-";
};

const toRiskLevelLabel = (level: unknown) => {
  if (typeof level !== "string" || !level) return "-";
  return riskLevelLabelMap[level] ?? level;
};

const toRiskLevelTagType = (level: unknown): TagType => {
  if (typeof level !== "string" || !level) return "info";
  return riskLevelTagTypeMap[level] ?? "info";
};

const aiGateTagType: Record<string, TagType> = {
  pending: "warning",
  assigned: "warning",
  running: "warning",
  completed: "success",
  failed: "danger",
  timeout: "danger"
};

type AiReviewRow = {
  node_key: string;
  outcome: string | null;
  comment: string | null;
  summary: string | null;
  completed_at: string | null;
  created_at: string;
};

type AiReviewNormalized = {
  outcomeCode: string | null;
  outcomeLabel: string;
  outcomeTagType: TagType;
  summaryText: string;
};

type InvoiceItemRow = {
  name: string;
  specification: string;
  unit: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
};

const parseAiPayload = (text: string | null | undefined) => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];
  const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of fencedMatches) {
    const body = match[1]?.trim();
    if (body) candidates.push(body);
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  const visited = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || Array.isArray(parsed)) continue;
      return {
        outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
        comment: typeof parsed.comment === "string" ? parsed.comment : null,
        summary: typeof parsed.summary === "string" ? parsed.summary : null
      };
    } catch {
      continue;
    }
  }

  return null;
};

const parseEmbeddedAiSummary = (text: string | null | undefined) => {
  return parseAiPayload(text);
};

const parseAiDecisionFromText = (text: string | null | undefined) => {
  const parsed = parseAiPayload(text);
  if (!parsed) return null;
  return {
    outcome: parsed.outcome,
    comment: parsed.comment
  };
};

const toAiOutcomeLabel = (
  outcome: string | null | undefined,
  comment: string | null | undefined
) => {
  if (outcome === "approve") return "建议通过";
  if (outcome === "reject") {
    const text = comment ?? "";
    return /补充|资料|证据|材料/.test(text) ? "建议补充材料" : "建议拒绝";
  }
  return "-";
};

const toAiOutcomeTagType = (
  outcome: string | null | undefined,
  comment: string | null | undefined
): TagType => {
  if (outcome === "approve") return "success";
  if (outcome === "reject") {
    const text = comment ?? "";
    return /补充|资料|证据|材料/.test(text) ? "warning" : "danger";
  }
  return "info";
};

const toContractDirectionLabel = (direction: unknown) => {
  if (direction === "outbound") return "对外付款";
  if (direction === "inbound") return "收款";
  if (typeof direction === "string" && direction) return direction;
  return "-";
};

const toContractDirectionTagType = (direction: unknown): TagType => {
  if (direction === "outbound") return "warning";
  if (direction === "inbound") return "success";
  return "info";
};

const paymentCategoryLabelMap: Record<string, string> = {
  special_approval: "特殊审批",
  admin_fee: "行政费",
  labor_fee: "劳务费",
  machinery_fee: "机械费",
  material_fee: "材料费",
  other_fee: "其他费用",
  specialApproval: "特殊审批",
  adminFee: "行政费",
  laborFee: "劳务费",
  machineryFee: "机械费",
  materialFee: "材料费",
  otherFee: "其他费用",
  特殊审批: "特殊审批",
  行政费: "行政费",
  劳务费: "劳务费",
  机械费: "机械费",
  材料费: "材料费",
  其他费用: "其他费用"
};

const paymentMethodLabelMap: Record<string, string> = {
  对公转账: "对公转账",
  现金: "现金",
  票据: "票据",
  其他: "其他"
};

const toPaymentCategoryLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentCategoryLabelMap[value] ?? value;
};

const toPaymentMethodLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentMethodLabelMap[value] ?? value;
};

const parseJsonObject = (
  raw: string | null | undefined
): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
};

const toInvoiceTypeLabel = (value: string | null | undefined) => {
  if (value === "electronic") return "电子发票";
  if (value === "special") return "增值税专票";
  if (value === "normal") return "增值税普票";
  return value || "-";
};

const toInvoiceCategoryLabel = (value: string | null | undefined) => {
  return value?.trim() || "-";
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseInvoiceItems = (
  raw: string | null | undefined
): InvoiceItemRow[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item): InvoiceItemRow => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const quantity = toNumberOrNull(row.quantity);
      const unitPrice = toNumberOrNull(row.unit_price);
      const explicitAmount = toNumberOrNull(row.amount);
      return {
        name: typeof row.name === "string" ? row.name : "",
        specification:
          typeof row.specification === "string" ? row.specification : "",
        unit: typeof row.unit === "string" ? row.unit : "",
        quantity,
        unit_price: unitPrice,
        amount:
          explicitAmount ??
          (quantity !== null && unitPrice !== null
            ? quantity * unitPrice
            : null)
      };
    });
  } catch {
    return [];
  }
};

const normalizeAiReview = (row: AiReviewRow): AiReviewNormalized => {
  const embedded = parseEmbeddedAiSummary(row.summary);
  const outcome = row.outcome ?? embedded?.outcome ?? null;
  const comment = row.comment ?? embedded?.comment ?? embedded?.summary ?? null;
  const summaryText =
    comment ??
    (row.summary && !parseEmbeddedAiSummary(row.summary)
      ? row.summary
      : null) ??
    "-";
  return {
    outcomeCode: outcome,
    outcomeLabel: toAiOutcomeLabel(outcome, comment),
    outcomeTagType: toAiOutcomeTagType(outcome, comment),
    summaryText
  };
};

const aiReviewByNodeKey = computed(() => {
  const map = new Map<string, AiReviewNormalized>();
  for (const row of aiGateReviews.value as AiReviewRow[]) {
    if (!row.node_key) continue;
    map.set(row.node_key, normalizeAiReview(row));
  }
  return map;
});

const getAiNodeSuggestion = (nodeKey: string): AiReviewNormalized | null => {
  return aiReviewByNodeKey.value.get(nodeKey) ?? null;
};

const formatAiNodeDecision = (task: ApprovalTask) => {
  if (task.assignee_userid !== "AI_GATE") {
    return toActionLabel(task.action);
  }
  const embedded = parseAiDecisionFromText(task.comment);
  const outcome = embedded?.outcome ?? task.action;
  const comment = embedded?.comment ?? task.comment;
  if (outcome || comment) {
    return toAiOutcomeLabel(outcome, comment);
  }
  const node = detail.value?.nodes.find(
    item => item.id === task.node_instance_id
  );
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.outcomeLabel ?? "-";
};

const formatAiNodeDecisionTagType = (task: ApprovalTask): TagType => {
  if (task.assignee_userid !== "AI_GATE") return "info";
  const embedded = parseAiDecisionFromText(task.comment);
  const outcome = embedded?.outcome ?? task.action;
  const comment = embedded?.comment ?? task.comment;
  if (outcome || comment) {
    return toAiOutcomeTagType(outcome, comment);
  }
  const node = detail.value?.nodes.find(
    item => item.id === task.node_instance_id
  );
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.outcomeTagType ?? "info";
};

const formatAiNodeComment = (task: ApprovalTask) => {
  if (task.assignee_userid !== "AI_GATE") return task.comment;
  const embedded = parseAiDecisionFromText(task.comment);
  if (embedded?.comment) return embedded.comment;
  if (task.comment) return task.comment;
  const node = detail.value?.nodes.find(
    item => item.id === task.node_instance_id
  );
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.summaryText === "-" ? "" : fallback?.summaryText;
};

type AttachmentItem = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

const parseAttachments = (raw: string | null | undefined): AttachmentItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list: Array<AttachmentItem | null> = parsed.map(item => {
      if (typeof item === "string") {
        return { file_key: item, file_name: item };
      }
      if (item && typeof item === "object") {
        const row = item as {
          file_key?: string;
          key?: string;
          file_name?: string;
          name?: string;
          file_size?: number;
          size?: number;
        };
        const key = row.file_key ?? row.key;
        if (!key) return null;
        return {
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          file_size: row.file_size ?? row.size
        };
      }
      return null;
    });
    return list.filter((item): item is AttachmentItem => item !== null);
  } catch {
    return [];
  }
};

const paymentAttachments = computed(() =>
  parseAttachments(paymentDetail.value?.attachments_json)
);
const contractAttachments = computed(() =>
  parseAttachments(contractDetail.value?.attachments_json)
);
const fileUrl = (fileKey: string) =>
  resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);

const projectNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of projects.value) {
    map.set(item.id, item.project_name);
  }
  return map;
});

const entityNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of entities.value) {
    map.set(item.id, item.entity_name);
  }
  return map;
});

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const item of wecomUsers.value) {
    map.set(item.userid, item.name || item.userid);
  }
  return map;
});

const toProjectLabel = (projectId: number | null | undefined) => {
  if (typeof projectId !== "number") return "-";
  return projectNameMap.value.get(projectId) ?? String(projectId);
};

const toEntityLabel = (entityId: number | null | undefined) => {
  if (typeof entityId !== "number") return "-";
  return entityNameMap.value.get(entityId) ?? String(entityId);
};

const toUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const toChineseAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";
  if (amount === 0) return "零元整";

  const fractionUnits = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const intUnits = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];

  let value = Math.round(amount * 100);
  const fraction = value % 100;
  let result = "";

  if (fraction === 0) {
    result = "整";
  } else {
    const jiao = Math.floor(fraction / 10);
    const fen = fraction % 10;
    if (jiao > 0) result += `${digit[jiao]}${fractionUnits[0]}`;
    if (fen > 0) result += `${digit[fen]}${fractionUnits[1]}`;
  }

  value = Math.floor(value / 100);
  let sectionIndex = 0;
  let intResult = "";

  while (value > 0 && sectionIndex < sectionUnits.length) {
    const sectionValue = value % 10000;
    if (sectionValue !== 0) {
      let sectionText = "";
      let unitIndex = 0;
      let section = sectionValue;
      let zeroPending = false;
      while (section > 0) {
        const num = section % 10;
        if (num === 0) {
          if (!zeroPending && sectionText) {
            zeroPending = true;
            sectionText = `零${sectionText}`;
          }
        } else {
          zeroPending = false;
          sectionText = `${digit[num]}${intUnits[unitIndex]}${sectionText}`;
        }
        unitIndex += 1;
        section = Math.floor(section / 10);
      }
      sectionText = sectionText.replace(/零+/g, "零").replace(/零$/g, "");
      intResult = `${sectionText}${sectionUnits[sectionIndex]}${intResult}`;
    } else if (intResult && !intResult.startsWith("零")) {
      intResult = `零${intResult}`;
    }
    sectionIndex += 1;
    value = Math.floor(value / 10000);
  }

  intResult = intResult.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
  intResult = intResult.replace(/亿万/g, "亿").replace(/零$/g, "");
  return `${intResult || "零"}元${result}`;
};

const formatAmount = (amount: number | null | undefined) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatAmountWithUpper = (
  amount: number | null | undefined,
  upper?: string | null
) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { lower: "-", upper: "-" };
  }
  const upperText =
    typeof upper === "string" && upper.trim()
      ? upper.trim()
      : toChineseAmount(amount);
  return {
    lower: formatAmount(amount),
    upper: upperText
  };
};

const paymentAmountDisplay = computed(() =>
  formatAmountWithUpper(
    paymentDetail.value?.amount,
    paymentDetail.value?.amount_cn
  )
);

const contractAmountDisplay = computed(() =>
  formatAmountWithUpper(contractDetail.value?.total_amount)
);

const reimbursementAmountDisplay = computed(() =>
  formatAmountWithUpper(reimbursementBatchDetail.value?.total_amount)
);

const invoiceRequestItems = computed(() =>
  parseInvoiceItems(invoiceRequestDetail.value?.items_json)
);

const loadMetaOptions = async () => {
  const [, entityRes] = await Promise.all([loadProjects(), listEntities()]);
  entities.value = entityRes.data;
  const grouped: Record<number, EntityBankAccount[]> = {};
  const accountResults = await Promise.all(
    entityRes.data.map(async item => {
      try {
        const res = await listEntityBankAccounts(item.id);
        return { entityId: item.id, accounts: res.data };
      } catch {
        return { entityId: item.id, accounts: [] as EntityBankAccount[] };
      }
    })
  );
  for (const item of accountResults) {
    grouped[item.entityId] = item.accounts.filter(
      account => account.status === "active"
    );
  }
  entityBankAccountMap.value = grouped;
};

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

const openAttachmentPreview = (fileKey: string, fileName: string) => {
  previewFileUrl.value = fileUrl(fileKey);
  previewFileName.value = fileName;
  previewDrawerVisible.value = true;
};

const uploadAttachmentFromApproval = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingApprovalAttachment.value = true;
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

    message("审批附件上传成功", { type: "success" });
    options.onSuccess?.({});
    await loadDetail();
  } catch {
    message("审批附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingApprovalAttachment.value = false;
  }
};

const goToLinkedContract = () => {
  const contractId = invoiceRequestDetail.value?.contract_id;
  if (!contractId) return;
  router.push(`/finance/contract/detail/${contractId}`);
};

const goToPaymentContract = () => {
  const contractId = paymentDetail.value?.contract_id;
  if (!contractId) return;
  router.push(`/finance/contract/detail/${contractId}`);
};

const bizNoLabel = computed(() => {
  if (!detail.value) return "-";
  const bizType = detail.value.instance.biz_type;
  if (bizType === "payment_request") {
    return (
      paymentDetail.value?.serial_no ?? String(detail.value.instance.biz_id)
    );
  }
  if (bizType === "outbound_contract" || bizType === "inbound_contract") {
    return (
      contractDetail.value?.contract_no ?? String(detail.value.instance.biz_id)
    );
  }
  if (bizType === "reimbursement_batch") {
    return (
      reimbursementBatchDetail.value?.batch_no ??
      String(detail.value.instance.biz_id)
    );
  }
  if (bizType === "invoice_request") {
    return (
      invoiceRequestDetail.value?.request_no ??
      String(detail.value.instance.biz_id)
    );
  }
  if (bizType === "receipt_refund") {
    return (
      receiptRefundDetail.value?.refund_no ??
      String(detail.value.instance.biz_id)
    );
  }
  return String(detail.value.instance.biz_id);
});

const bizDetailRoute = computed<RouteLocationRaw | null>(() => {
  if (!detail.value) return null;
  const bizType = detail.value.instance.biz_type;
  if (bizType === "payment_request" && paymentDetail.value) {
    return `/finance/payment/detail/${paymentDetail.value.id}`;
  }
  if (
    (bizType === "outbound_contract" || bizType === "inbound_contract") &&
    contractDetail.value
  ) {
    return `/finance/contract/detail/${contractDetail.value.id}`;
  }
  if (bizType === "reimbursement_batch" && reimbursementBatchDetail.value) {
    return `/finance/reimbursement/batch/${reimbursementBatchDetail.value.id}`;
  }
  if (bizType === "invoice_request") {
    const keyword = invoiceRequestDetail.value?.request_no?.trim() || "";
    return keyword
      ? { path: "/finance/receipt/invoice", query: { keyword } }
      : "/finance/receipt/invoice";
  }
  if (bizType === "receipt_refund" && receiptRefundDetail.value) {
    return `/finance/receipt/detail/${receiptRefundDetail.value.receipt.id}`;
  }
  return null;
});

const canOpenFinanceBizPage = computed(() => {
  const roles = userStore.roles ?? [];
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("finance")
  );
});

const canGoToBizDetail = computed(() => {
  return Boolean(bizDetailRoute.value) && canOpenFinanceBizPage.value;
});

const goToBizDetail = () => {
  if (!bizDetailRoute.value || !canGoToBizDetail.value) return;
  router.push(bizDetailRoute.value);
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const result = await getApprovalDetail(instanceId.value);
    detail.value = result.data;
    selectedRound.value = result.data.instance.current_round;
    paymentDetail.value = null;
    contractDetail.value = null;
    reimbursementBatchDetail.value = null;
    invoiceRequestDetail.value = null;
    invoiceLinkedContract.value = null;
    receiptRefundDetail.value = null;

    const bizType = result.data.instance.biz_type;
    const bizId = result.data.instance.biz_id;

    if (bizType === "payment_request") {
      const paymentRes = await getPaymentRequest(bizId);
      paymentDetail.value = paymentRes.data;
      payoutForm.value = {
        payment_entity_id: paymentRes.data.payment_entity_id ?? undefined,
        payment_entity_bank_account_id:
          paymentRes.data.payment_entity_bank_account_id ?? undefined,
        payment_account: paymentRes.data.payment_account ?? ""
      };
      if (
        payoutForm.value.payment_entity_id &&
        !payoutForm.value.payment_entity_bank_account_id
      ) {
        const accounts =
          entityBankAccountMap.value[
            payoutForm.value.payment_entity_id
          ]?.filter(item => item.status === "active") ?? [];
        if (accounts.length > 0) {
          payoutForm.value.payment_entity_bank_account_id = accounts[0].id;
          payoutForm.value.payment_account = `${accounts[0].bank_name} / ${accounts[0].account_no}`;
        }
      }
    } else if (
      bizType === "outbound_contract" ||
      bizType === "inbound_contract"
    ) {
      const contractRes = await getContract(bizId);
      contractDetail.value = contractRes.data;
    } else if (bizType === "reimbursement_batch") {
      const reimbursementRes = await getReimbursementBatch(bizId);
      reimbursementBatchDetail.value = reimbursementRes.data;
    } else if (bizType === "invoice_request") {
      const invoiceRequestRes = await getInvoiceRequest(bizId);
      invoiceRequestDetail.value = invoiceRequestRes.data;
      const contractRes = await getContract(invoiceRequestRes.data.contract_id);
      invoiceLinkedContract.value = contractRes.data;
    } else if (bizType === "receipt_refund") {
      const refundRes = await getReceiptRefund(bizId);
      receiptRefundDetail.value = refundRes.data;
    }

    if (bizType === "payment_request") {
      const rr = await getRiskReport(bizId);
      paymentRiskStatus.value = rr.data.status;
      paymentRiskReport.value = rr.data.result;
      reimbursementAuditStatus.value = "none";
      reimbursementAuditReport.value = null;
    } else if (bizType === "reimbursement_batch") {
      const rr = await getBatchAuditReport(bizId);
      reimbursementAuditStatus.value = rr.data.status;
      reimbursementAuditReport.value = rr.data.result;
      paymentRiskStatus.value = "none";
      paymentRiskReport.value = null;
    } else {
      paymentRiskStatus.value = "none";
      paymentRiskReport.value = null;
      reimbursementAuditStatus.value = "none";
      reimbursementAuditReport.value = null;
    }
  } catch {
    message("加载审批详情失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

const notifySuccessAndGoPending = async (successText: string) => {
  message(`${successText}，正在返回待我审批`, {
    type: "success",
    duration: 800
  });
  await sleep(800);
  await router.push(pendingApprovalRoute);
};

const handleApprove = async () => {
  if (!commentInput.value.trim()) {
    message("请输入审批意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await syncPayoutSelection();
    await approveApproval(instanceId.value, { comment: commentInput.value });
    commentInput.value = "";
    await notifySuccessAndGoPending("审批通过");
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleReject = async () => {
  if (!commentInput.value.trim()) {
    message("请输入审批意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await rejectApproval(instanceId.value, { comment: commentInput.value });
    commentInput.value = "";
    await notifySuccessAndGoPending("审批已驳回");
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const openReturnDialog = () => {
  returnType.value = "initiator";
  returnTargetNodeKey.value = "";
  returnComment.value = "";
  returnDialogVisible.value = true;
};

const handleReturn = async () => {
  actionLoading.value = true;
  try {
    await returnApproval(instanceId.value, {
      type: returnType.value,
      target_node_key:
        returnType.value === "to" ? returnTargetNodeKey.value : undefined,
      comment: returnComment.value || undefined
    });
    returnDialogVisible.value = false;
    await notifySuccessAndGoPending("审批已退回");
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const openTransferDialog = () => {
  transferToUserid.value = "";
  transferReason.value = "";
  transferDialogVisible.value = true;
};

const openForceTransferDialog = (task: ApprovalTask) => {
  forceTransferTaskId.value = task.id;
  forceTransferFromUserid.value = task.assignee_userid;
  forceTransferToUserid.value = "";
  forceTransferReason.value = "";
  forceTransferDialogVisible.value = true;
};

const handleTransfer = async () => {
  if (!transferToUserid.value.trim() || !transferReason.value.trim()) {
    message("请填写转办人和原因", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await transferApproval(instanceId.value, {
      to_userid: transferToUserid.value,
      reason: transferReason.value
    });
    transferDialogVisible.value = false;
    await notifySuccessAndGoPending("审批已转办");
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleForceTransfer = async () => {
  if (!forceTransferTaskId.value) {
    message("未选择待改派任务", { type: "warning" });
    return;
  }
  if (
    !forceTransferToUserid.value.trim() ||
    !forceTransferReason.value.trim()
  ) {
    message("请填写改派目标审批人与原因", { type: "warning" });
    return;
  }
  if (forceTransferToUserid.value.trim() === forceTransferFromUserid.value) {
    message("目标审批人与当前审批人相同", { type: "warning" });
    return;
  }

  actionLoading.value = true;
  try {
    await forceTransferApproval(instanceId.value, {
      task_id: forceTransferTaskId.value,
      to_userid: forceTransferToUserid.value.trim(),
      reason: forceTransferReason.value.trim()
    });
    message("已强制改派审批人", { type: "success" });
    forceTransferDialogVisible.value = false;
    await loadDetail();
  } catch {
    message("强制改派失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleWithdraw = async () => {
  actionLoading.value = true;
  try {
    await withdrawApproval(instanceId.value);
    message("已撤回", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleCancel = async () => {
  actionLoading.value = true;
  try {
    await cancelApproval(instanceId.value);
    message("已取消", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleResubmit = async () => {
  actionLoading.value = true;
  try {
    await resubmitApproval(instanceId.value);
    message("已重新提交", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const goBack = () => router.push(pendingApprovalRoute);

onMounted(async () => {
  await Promise.all([loadWecomUsers(), loadMetaOptions()]);
  await loadDetail();
});
</script>

<template>
  <div v-loading="loading">
    <el-page-header style="margin-bottom: 16px" @back="goBack">
      <template #content>
        <span v-if="detail"
          >{{ detail.instance.instance_no }} —
          {{ detail.instance.biz_summary }}</span
        >
      </template>
    </el-page-header>

    <template v-if="detail">
      <el-row :gutter="16">
        <el-col :md="14" :xs="24">
          <el-card shadow="never" header="业务摘要">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="审批编号">{{
                detail.instance.instance_no
              }}</el-descriptions-item>
              <el-descriptions-item label="业务类型">{{
                toBizTypeLabel(detail.instance.biz_type)
              }}</el-descriptions-item>
              <el-descriptions-item label="业务编号">
                <el-link
                  v-if="canGoToBizDetail"
                  type="primary"
                  @click="goToBizDetail"
                >
                  {{ bizNoLabel }}
                </el-link>
                <template v-else>{{ bizNoLabel }}</template>
              </el-descriptions-item>
              <el-descriptions-item label="发起人">{{
                toUserLabel(detail.instance.initiator_userid)
              }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag size="small">{{
                  toStatusLabel(detail.instance.status)
                }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="提交时间">{{
                formatBeijingDateTime(detail.instance.submitted_at)
              }}</el-descriptions-item>
              <el-descriptions-item label="完成时间">{{
                detail.instance.completed_at
                  ? formatBeijingDateTime(detail.instance.completed_at)
                  : "—"
              }}</el-descriptions-item>
              <el-descriptions-item label="摘要" :span="2">{{
                detail.instance.biz_summary
              }}</el-descriptions-item>
            </el-descriptions>

            <template v-if="detail.instance.biz_type === 'payment_request'">
              <el-divider>付款风险评估</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[paymentRiskStatus] || 'info'">
                  {{ toStatusLabel(paymentRiskStatus) }}
                </el-tag>
              </div>
              <el-descriptions v-if="paymentRiskReport" :column="2" border>
                <el-descriptions-item label="风险等级">
                  <el-tag
                    :type="toRiskLevelTagType(paymentRiskReport.overall_risk)"
                  >
                    {{ toRiskLevelLabel(paymentRiskReport.overall_risk) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="风险分数">
                  {{ paymentRiskReport.score ?? "-" }}
                </el-descriptions-item>
                <el-descriptions-item label="总结" :span="2">
                  {{ paymentRiskReport.summary || "-" }}
                </el-descriptions-item>
                <el-descriptions-item label="建议" :span="2">
                  {{
                    Array.isArray(paymentRiskReport.recommendations)
                      ? paymentRiskReport.recommendations.join("；")
                      : "-"
                  }}
                </el-descriptions-item>
              </el-descriptions>
            </template>

            <template v-if="paymentDetail">
              <el-divider>申请明细（付款）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="流水号">
                  <el-link
                    v-if="canGoToBizDetail"
                    type="primary"
                    @click="goToBizDetail"
                  >
                    {{ paymentDetail.serial_no }}
                  </el-link>
                  <template v-else>{{ paymentDetail.serial_no }}</template>
                </el-descriptions-item>
                <el-descriptions-item label="关联合同">
                  <el-link
                    v-if="paymentDetail.contract && paymentDetail.contract_id"
                    type="primary"
                    @click="goToPaymentContract"
                  >
                    {{
                      `${paymentDetail.contract.contract_no} - ${paymentDetail.contract.counterparty}`
                    }}
                  </el-link>
                  <template v-else>无合同 / 无需合同</template>
                </el-descriptions-item>
                <el-descriptions-item label="所属项目">{{
                  toProjectLabel(paymentDetail.project_id)
                }}</el-descriptions-item>
                <el-descriptions-item label="收款方">{{
                  paymentDetail.payee?.name || "-"
                }}</el-descriptions-item>
                <el-descriptions-item label="收款账号" :span="2">
                  {{
                    paymentDetail.payee
                      ? `${paymentDetail.payee.bank_name} / ${paymentDetail.payee.bank_account}`
                      : "-"
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="申请金额">
                  {{ paymentAmountDisplay.lower }}（<strong>{{
                    paymentAmountDisplay.upper
                  }}</strong
                  >）
                </el-descriptions-item>
                <el-descriptions-item label="付款类别">{{
                  toPaymentCategoryLabel(paymentDetail.category)
                }}</el-descriptions-item>
                <el-descriptions-item label="预计付款日">{{
                  paymentDetail.expected_payment_date
                }}</el-descriptions-item>
                <el-descriptions-item label="付款方式">{{
                  toPaymentMethodLabel(paymentDetail.payment_method)
                }}</el-descriptions-item>
                <el-descriptions-item label="付款内容" :span="2">{{
                  paymentDetail.content
                }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{
                  paymentDetail.remark || "-"
                }}</el-descriptions-item>
              </el-descriptions>
              <el-upload
                v-if="canUploadInApproval"
                drag
                :show-file-list="false"
                :http-request="uploadAttachmentFromApproval"
                style="margin-top: 12px"
              >
                <div class="el-upload__text">
                  上传审批附件（付款），或 <em>点击上传</em>
                </div>
              </el-upload>
              <el-table
                :data="paymentAttachments"
                size="small"
                border
                style="margin-top: 12px"
              >
                <el-table-column label="附件名" min-width="240">
                  <template #default="scope">{{
                    scope.row.file_name
                  }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{
                    scope.row.file_size ?? "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="操作" width="190">
                  <template #default="scope">
                    <el-link
                      type="primary"
                      @click="
                        openAttachmentPreview(
                          scope.row.file_key,
                          scope.row.file_name
                        )
                      "
                    >
                      预览
                    </el-link>
                    <el-link
                      :href="fileUrl(scope.row.file_key)"
                      target="_blank"
                      type="primary"
                    >
                      下载
                    </el-link>
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="contractDetail">
              <el-divider>申请明细（合同）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="合同号">
                  <el-link
                    v-if="canGoToBizDetail"
                    type="primary"
                    @click="goToBizDetail"
                  >
                    {{ contractDetail.contract_no }}
                  </el-link>
                  <template v-else>{{ contractDetail.contract_no }}</template>
                </el-descriptions-item>
                <el-descriptions-item label="方向">
                  <el-tag
                    :type="toContractDirectionTagType(contractDetail.direction)"
                    size="small"
                  >
                    <strong>{{
                      toContractDirectionLabel(contractDetail.direction)
                    }}</strong>
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="所属项目">{{
                  toProjectLabel(contractDetail.project_id)
                }}</el-descriptions-item>
                <el-descriptions-item label="我方主体">{{
                  toEntityLabel(contractDetail.entity_id)
                }}</el-descriptions-item>
                <el-descriptions-item label="对方单位">{{
                  contractDetail.counterparty
                }}</el-descriptions-item>
                <el-descriptions-item label="合同类型">{{
                  contractDetail.contract_type
                }}</el-descriptions-item>
                <el-descriptions-item label="经办人">{{
                  toUserLabel(contractDetail.handler_userid)
                }}</el-descriptions-item>
                <el-descriptions-item label="合同日期">{{
                  contractDetail.contract_date
                }}</el-descriptions-item>
                <el-descriptions-item label="合同金额">
                  {{ contractAmountDisplay.lower }}（<strong>{{
                    contractAmountDisplay.upper
                  }}</strong
                  >）
                </el-descriptions-item>
                <el-descriptions-item label="已付金额">{{
                  contractDetail.paid_amount
                }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{
                  contractDetail.remark || "-"
                }}</el-descriptions-item>
              </el-descriptions>
              <el-upload
                v-if="canUploadInApproval"
                drag
                :show-file-list="false"
                :http-request="uploadAttachmentFromApproval"
                style="margin-top: 12px"
              >
                <div class="el-upload__text">
                  上传审批附件（合同），或 <em>点击上传</em>
                </div>
              </el-upload>
              <el-table
                :data="contractAttachments"
                size="small"
                border
                style="margin-top: 12px"
              >
                <el-table-column label="附件名" min-width="240">
                  <template #default="scope">{{
                    scope.row.file_name
                  }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{
                    scope.row.file_size ?? "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="操作" width="190">
                  <template #default="scope">
                    <el-link
                      type="primary"
                      @click="
                        openAttachmentPreview(
                          scope.row.file_key,
                          scope.row.file_name
                        )
                      "
                    >
                      预览
                    </el-link>
                    <el-link
                      :href="fileUrl(scope.row.file_key)"
                      target="_blank"
                      type="primary"
                    >
                      下载
                    </el-link>
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="reimbursementBatchDetail">
              <el-divider>申请明细（报销批次）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="批次号">
                  <el-link
                    v-if="canGoToBizDetail"
                    type="primary"
                    @click="goToBizDetail"
                  >
                    {{ reimbursementBatchDetail.batch_no }}
                  </el-link>
                  <template v-else>{{
                    reimbursementBatchDetail.batch_no
                  }}</template>
                </el-descriptions-item>
                <el-descriptions-item label="状态">{{
                  reimbursementBatchDetail.status
                }}</el-descriptions-item>
                <el-descriptions-item label="所属项目">{{
                  toProjectLabel(reimbursementBatchDetail.project_id)
                }}</el-descriptions-item>
                <el-descriptions-item label="申请人">{{
                  toUserLabel(reimbursementBatchDetail.applicant_userid)
                }}</el-descriptions-item>
                <el-descriptions-item label="总金额">
                  {{ reimbursementAmountDisplay.lower }}（<strong>{{
                    reimbursementAmountDisplay.upper
                  }}</strong
                  >）
                </el-descriptions-item>
                <el-descriptions-item label="单据数">{{
                  reimbursementBatchDetail.item_count
                }}</el-descriptions-item>
              </el-descriptions>
              <el-table
                :data="reimbursementBatchDetail.items"
                size="small"
                border
                style="margin-top: 12px"
              >
                <el-table-column
                  prop="envelope_no"
                  label="报销单号"
                  min-width="150"
                />
                <el-table-column
                  prop="invoice_no"
                  label="发票号"
                  min-width="150"
                />
                <el-table-column prop="amount" label="金额" width="120" />
                <el-table-column prop="category" label="类别" width="120" />
                <el-table-column
                  prop="description"
                  label="说明"
                  min-width="220"
                />
                <el-table-column label="单项AI结论" min-width="260">
                  <template #default="scope">
                    {{ scope.row.ai_reasonability_summary || "-" }}
                  </template>
                </el-table-column>
                <el-table-column label="票据识别风险" width="120">
                  <template #default="scope">
                    <el-tag
                      v-if="scope.row.invoice_review_highest_risk"
                      :type="
                        toRiskLevelTagType(
                          scope.row.invoice_review_highest_risk
                        )
                      "
                      size="small"
                    >
                      {{
                        toInvoiceReviewRiskLabel(
                          scope.row.invoice_review_highest_risk
                        )
                      }}
                    </el-tag>
                    <template v-else>-</template>
                  </template>
                </el-table-column>
                <el-table-column label="抽查附件" min-width="280">
                  <template #default="scope">
                    <template
                      v-if="
                        Array.isArray(scope.row.attachments) &&
                        scope.row.attachments.length
                      "
                    >
                      <div
                        v-for="attachment in scope.row.attachments"
                        :key="`${scope.row.id}-${attachment.id}`"
                        style="
                          display: flex;
                          gap: 8px;
                          align-items: center;
                          margin-bottom: 4px;
                        "
                      >
                        <span
                          style="
                            max-width: 140px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                          "
                        >
                          {{ attachment.file_name || attachment.file_key }}
                        </span>
                        <el-link
                          type="primary"
                          @click="
                            openAttachmentPreview(
                              attachment.file_key,
                              attachment.file_name || attachment.file_key
                            )
                          "
                        >
                          预览
                        </el-link>
                        <el-link
                          :href="fileUrl(attachment.file_key)"
                          target="_blank"
                          type="primary"
                        >
                          下载
                        </el-link>
                      </div>
                    </template>
                    <template v-else>-</template>
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="invoiceRequestDetail">
              <el-divider>申请明细（开票申请）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="申请单号">
                  <el-link
                    v-if="canGoToBizDetail"
                    type="primary"
                    @click="goToBizDetail"
                  >
                    {{ invoiceRequestDetail.request_no }}
                  </el-link>
                  <template v-else>{{
                    invoiceRequestDetail.request_no
                  }}</template>
                </el-descriptions-item>
                <el-descriptions-item label="状态">{{
                  toStatusLabel(invoiceRequestDetail.status)
                }}</el-descriptions-item>
                <el-descriptions-item label="对方名称">{{
                  invoiceRequestDetail.customer_name
                }}</el-descriptions-item>
                <el-descriptions-item label="对方税号">{{
                  invoiceRequestDetail.customer_tax_no
                }}</el-descriptions-item>
                <el-descriptions-item label="对方联系方式">
                  {{
                    (parseJsonObject(invoiceRequestDetail.buyer_json)
                      .counterparty_contact as string | undefined) || "-"
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="我方开票主体">
                  {{
                    (parseJsonObject(invoiceRequestDetail.buyer_json)
                      .seller_entity_name as string | undefined) || "-"
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="所属项目">{{
                  toProjectLabel(invoiceRequestDetail.project_id)
                }}</el-descriptions-item>
                <el-descriptions-item label="关联合同号">
                  <el-link type="primary" @click="goToLinkedContract">
                    {{
                      invoiceRequestDetail.business_contract_no ||
                      invoiceLinkedContract?.contract_no ||
                      "-"
                    }}
                  </el-link>
                  <el-tag
                    v-if="invoiceLinkedContract"
                    size="small"
                    :type="
                      toContractDirectionTagType(
                        invoiceLinkedContract.direction
                      )
                    "
                    style="margin-left: 8px"
                  >
                    {{
                      toContractDirectionLabel(invoiceLinkedContract.direction)
                    }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="发票类型">{{
                  toInvoiceTypeLabel(invoiceRequestDetail.invoice_type)
                }}</el-descriptions-item>
                <el-descriptions-item label="发票类目">{{
                  toInvoiceCategoryLabel(invoiceRequestDetail.invoice_category)
                }}</el-descriptions-item>
                <el-descriptions-item label="税率"
                  >{{ invoiceRequestDetail.tax_rate }}%</el-descriptions-item
                >
                <el-descriptions-item label="币种">{{
                  invoiceRequestDetail.currency
                }}</el-descriptions-item>
                <el-descriptions-item label="不含税金额">{{
                  formatAmount(invoiceRequestDetail.amount_without_tax)
                }}</el-descriptions-item>
                <el-descriptions-item label="预计税额">{{
                  formatAmount(invoiceRequestDetail.tax_amount_estimated)
                }}</el-descriptions-item>
                <el-descriptions-item label="价税合计">{{
                  formatAmount(invoiceRequestDetail.amount_with_tax)
                }}</el-descriptions-item>
                <el-descriptions-item label="申请人">{{
                  toUserLabel(invoiceRequestDetail.applicant_userid)
                }}</el-descriptions-item>
                <el-descriptions-item label="汇款凭证">{{
                  invoiceRequestDetail.payment_reference || "-"
                }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{
                  invoiceRequestDetail.remark || "-"
                }}</el-descriptions-item>
              </el-descriptions>
              <el-table
                :data="invoiceRequestItems"
                size="small"
                border
                style="margin-top: 12px"
              >
                <el-table-column label="名称" min-width="180">
                  <template #default="scope">{{
                    scope.row.name || "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="规格" min-width="150">
                  <template #default="scope">{{
                    scope.row.specification || "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="单位" width="90">
                  <template #default="scope">{{
                    scope.row.unit || "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="数量" width="120">
                  <template #default="scope">{{
                    scope.row.quantity ?? "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="单价" width="140">
                  <template #default="scope">{{
                    formatAmount(scope.row.unit_price)
                  }}</template>
                </el-table-column>
                <el-table-column label="金额" width="160">
                  <template #default="scope">{{
                    formatAmount(scope.row.amount)
                  }}</template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="receiptRefundDetail">
              <el-divider>申请明细（收款退款）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="退款单号">
                  <el-link
                    v-if="canGoToBizDetail"
                    type="primary"
                    @click="goToBizDetail"
                  >
                    {{ receiptRefundDetail.refund_no }}
                  </el-link>
                  <template v-else>{{
                    receiptRefundDetail.refund_no
                  }}</template>
                </el-descriptions-item>
                <el-descriptions-item label="退款方式">
                  {{
                    receiptRefundDetail.refund_mode === "full"
                      ? "全部退款"
                      : "部分退款"
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="退款金额">{{
                  formatAmount(receiptRefundDetail.amount)
                }}</el-descriptions-item>
                <el-descriptions-item label="收款单号">{{
                  receiptRefundDetail.receipt.receipt_no
                }}</el-descriptions-item>
                <el-descriptions-item label="收款日期">{{
                  receiptRefundDetail.receipt.received_date
                }}</el-descriptions-item>
                <el-descriptions-item label="收款金额">{{
                  formatAmount(receiptRefundDetail.receipt.amount)
                }}</el-descriptions-item>
                <el-descriptions-item label="收款账户" :span="2">{{
                  receiptRefundDetail.receipt.payment_account || "-"
                }}</el-descriptions-item>
                <el-descriptions-item label="合同号">{{
                  receiptRefundDetail.contract.contract_no
                }}</el-descriptions-item>
                <el-descriptions-item label="合同对方">{{
                  receiptRefundDetail.contract.counterparty
                }}</el-descriptions-item>
                <el-descriptions-item label="合同金额">{{
                  formatAmount(receiptRefundDetail.contract.total_amount)
                }}</el-descriptions-item>
                <el-descriptions-item label="合同已收">{{
                  formatAmount(receiptRefundDetail.contract.received_amount)
                }}</el-descriptions-item>
                <el-descriptions-item label="是否含发票" :span="2">
                  {{
                    receiptRefundDetail.invoice
                      ? "是（流程含红冲发票签发）"
                      : "否"
                  }}
                </el-descriptions-item>
                <el-descriptions-item
                  v-if="receiptRefundDetail.invoice"
                  label="发票号"
                >
                  {{ receiptRefundDetail.invoice?.invoice_no || "-" }}
                </el-descriptions-item>
                <el-descriptions-item
                  v-if="receiptRefundDetail.invoice"
                  label="发票金额"
                >
                  {{
                    formatAmount(
                      receiptRefundDetail.invoice?.amount_with_tax ??
                        receiptRefundDetail.invoice?.amount ??
                        null
                    )
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="退款原因" :span="2">{{
                  receiptRefundDetail.reason || "-"
                }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{
                  receiptRefundDetail.remark || "-"
                }}</el-descriptions-item>
              </el-descriptions>
            </template>

            <template v-if="aiGateReviews.length > 0">
              <el-divider>AI审核结果</el-divider>
              <el-table :data="aiGateReviews" size="small" border>
                <el-table-column label="节点" min-width="130">
                  <template #default="scope">
                    {{ scope.row.node_key || "-" }}
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="scope">
                    <el-tag
                      :type="aiGateTagType[scope.row.status] || 'info'"
                      size="small"
                    >
                      {{ toStatusLabel(scope.row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="结论" width="120">
                  <template #default="scope">
                    <el-tag
                      :type="normalizeAiReview(scope.row).outcomeTagType"
                      size="small"
                    >
                      {{ normalizeAiReview(scope.row).outcomeLabel }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="总结" min-width="220">
                  <template #default="scope">
                    {{ normalizeAiReview(scope.row).summaryText }}
                  </template>
                </el-table-column>
                <el-table-column label="完成时间" width="170">
                  <template #default="scope">
                    {{ formatBeijingDateTime(scope.row.completed_at) }}
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="detail.instance.biz_type === 'reimbursement_batch'">
              <el-divider>报销批次AI审计报告</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[reimbursementAuditStatus] || 'info'">
                  {{ toStatusLabel(reimbursementAuditStatus) }}
                </el-tag>
              </div>
              <pre style="white-space: pre-wrap; word-break: break-word">{{
                reimbursementAuditReport || "-"
              }}</pre>
            </template>
          </el-card>
        </el-col>

        <el-col :md="10" :xs="24">
          <el-card shadow="never" header="审批流程">
            <div v-if="availableRounds.length > 1" style="margin-bottom: 12px">
              <el-radio-group v-model="selectedRound" size="small">
                <el-radio-button
                  v-for="r in availableRounds"
                  :key="r"
                  :value="r"
                >
                  第 {{ r }} 轮
                </el-radio-button>
              </el-radio-group>
            </div>

            <el-timeline>
              <el-timeline-item
                v-for="node in roundNodes"
                :key="node.id"
                :color="nodeStatusColor[node.status]"
                :hollow="node.status === 'pending'"
              >
                <div
                  :style="{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border:
                      detail.instance.current_node_key === node.node_key
                        ? '1px solid #2f6c5f'
                        : '1px solid transparent',
                    background:
                      detail.instance.current_node_key === node.node_key
                        ? '#f0f9f6'
                        : 'transparent'
                  }"
                >
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      margin-bottom: 4px;
                    "
                  >
                    <strong>{{ node.node_name }}</strong>
                    <el-tag size="small" type="info">{{
                      nodeTypeLabelMap[node.node_type] ?? node.node_type
                    }}</el-tag>
                    <el-tag
                      size="small"
                      :type="node.status === 'completed' ? 'success' : 'info'"
                      >{{ toStatusLabel(node.status) }}</el-tag
                    >
                  </div>
                  <div style="font-size: 13px; color: #666; margin-bottom: 4px">
                    设定审批人：
                    <template
                      v-if="
                        getNodeAssigneeLabels(node.assignee_userids).length > 0
                      "
                    >
                      {{
                        getNodeAssigneeLabels(node.assignee_userids).join("、")
                      }}
                    </template>
                    <template v-else>-</template>
                  </div>
                  <div
                    v-for="task in getNodeTasks(node.id)"
                    :key="task.id"
                    style="font-size: 13px; color: #666; margin-top: 4px"
                  >
                    <span>{{ toUserLabel(task.assignee_userid) }}</span>
                    <el-button
                      v-if="
                        isSuperAdmin &&
                        task.status === 'pending' &&
                        task.assignee_userid !== 'AI_GATE'
                      "
                      link
                      type="warning"
                      style="margin-left: 8px"
                      @click="openForceTransferDialog(task)"
                    >
                      强制改派
                    </el-button>
                    <el-tag
                      v-if="task.action"
                      :type="formatAiNodeDecisionTagType(task)"
                      size="small"
                      style="margin-left: 6px"
                      >{{ formatAiNodeDecision(task) }}</el-tag
                    >
                    <span
                      v-if="
                        task.assignee_userid === 'AI_GATE' &&
                        formatAiNodeComment(task)
                      "
                      style="margin-left: 6px; color: #666"
                    >
                      ：{{ formatAiNodeComment(task) }}
                    </span>
                    <span
                      v-if="task.acted_at"
                      style="margin-left: 6px; color: #999"
                      >{{ formatBeijingDateTime(task.acted_at) }}</span
                    >
                    <div
                      v-if="task.comment && task.assignee_userid !== 'AI_GATE'"
                      style="margin-top: 2px; color: #888; font-style: italic"
                    >
                      {{ task.comment }}
                    </div>
                  </div>
                </div>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </el-col>
      </el-row>

      <el-card
        v-if="detail.available_actions.length > 0"
        shadow="never"
        header="操作区"
        style="margin-top: 16px"
      >
        <el-card
          v-if="canAdjustPayoutInApprovalWorkbench"
          shadow="never"
          style="margin-bottom: 12px; background: #f8fafc"
        >
          <template #header>
            <span>审批台付款主体与账户</span>
          </template>
          <el-form inline>
            <el-form-item label="付款主体">
              <el-select
                v-model="payoutForm.payment_entity_id"
                filterable
                clearable
                style="min-width: 220px"
                placeholder="选择付款主体"
                @change="onPayoutEntityChange"
              >
                <el-option
                  v-for="item in entities"
                  :key="item.id"
                  :label="item.entity_name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="付款账户">
              <el-select
                v-model="payoutForm.payment_entity_bank_account_id"
                filterable
                clearable
                style="min-width: 300px"
                placeholder="选择付款账户"
                @change="onPayoutAccountChange"
              >
                <el-option
                  v-for="item in payoutEntityAccounts"
                  :key="item.id"
                  :label="`${item.bank_name} / ${item.account_no}`"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button :loading="actionLoading" @click="savePayoutSelection"
                >保存付款选择</el-button
              >
            </el-form-item>
          </el-form>
        </el-card>

        <el-input
          v-if="hasAction('approve') || hasAction('reject')"
          v-model="commentInput"
          type="textarea"
          :rows="3"
          placeholder="请输入审批意见（审批/驳回时必填）"
          style="margin-bottom: 12px"
        />
        <el-space>
          <el-button
            v-if="hasAction('approve')"
            type="success"
            :loading="actionLoading"
            @click="handleApprove"
          >
            审批通过
          </el-button>
          <el-button
            v-if="hasAction('reject')"
            type="danger"
            :loading="actionLoading"
            @click="handleReject"
          >
            驳回
          </el-button>
          <el-button
            v-if="
              hasAction('return_initiator') ||
              hasAction('return_prev') ||
              hasAction('return_to')
            "
            type="warning"
            :loading="actionLoading"
            @click="openReturnDialog"
          >
            退回
          </el-button>
          <el-button
            v-if="hasAction('transfer')"
            :loading="actionLoading"
            @click="openTransferDialog"
          >
            转办
          </el-button>
          <el-button
            v-if="hasAction('withdraw')"
            :loading="actionLoading"
            @click="handleWithdraw"
          >
            撤回
          </el-button>
          <el-button
            v-if="hasAction('cancel')"
            :loading="actionLoading"
            @click="handleCancel"
          >
            {{ cancelActionLabel }}
          </el-button>
          <el-button
            v-if="hasAction('resubmit')"
            type="primary"
            :loading="actionLoading"
            @click="handleResubmit"
          >
            重新提交
          </el-button>
        </el-space>
      </el-card>
    </template>

    <el-drawer v-model="previewDrawerVisible" title="附件预览" size="70%">
      <div style="height: calc(100vh - 120px)">
        <div style="margin-bottom: 8px; color: #666">
          {{ previewFileName }}
        </div>
        <template v-if="previewInline">
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

    <el-dialog v-model="returnDialogVisible" title="退回审批" width="480px">
      <el-form label-width="80px">
        <el-form-item label="退回方式">
          <el-radio-group v-model="returnType">
            <el-radio value="initiator">退回发起人</el-radio>
            <el-radio value="prev">退回上一步</el-radio>
            <el-radio value="to">退回指定节点</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="returnType === 'to'" label="目标节点">
          <el-select v-model="returnTargetNodeKey" placeholder="选择节点">
            <el-option
              v-for="node in roundNodes.filter(n => n.status === 'completed')"
              :key="node.node_key"
              :label="node.node_name"
              :value="node.node_key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="退回意见">
          <el-input v-model="returnComment" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="handleReturn"
          >确定退回</el-button
        >
      </template>
    </el-dialog>

    <el-dialog v-model="transferDialogVisible" title="转办审批" width="480px">
      <el-form label-width="80px">
        <el-form-item label="转办给">
          <el-select
            v-model="transferToUserid"
            clearable
            filterable
            placeholder="选择公司人员"
            style="width: 100%"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="`${item.name} (${item.userid})`"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="转办原因">
          <el-input v-model="transferReason" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="actionLoading"
          @click="handleTransfer"
          >确定转办</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="forceTransferDialogVisible"
      title="强制改派审批人（超管）"
      width="520px"
    >
      <el-alert
        type="warning"
        :closable="false"
        title="该操作将直接替换当前待审批任务的审批人，并记录 super_admin 强制改派痕迹。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="110px">
        <el-form-item label="当前审批人">
          <el-input :model-value="forceTransferFromUserid || '-'" disabled />
        </el-form-item>
        <el-form-item label="改派给">
          <el-select
            v-model="forceTransferToUserid"
            clearable
            filterable
            placeholder="选择公司人员"
            style="width: 100%"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="`${item.name} (${item.userid})`"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="改派原因">
          <el-input v-model="forceTransferReason" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="forceTransferDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="actionLoading"
          @click="handleForceTransfer"
          >确认强制改派</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
