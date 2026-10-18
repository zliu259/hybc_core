<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import AiReviewReport from "@/components/AiReviewReport/index.vue";
import { contractTypeLabel, statusLabel } from "@/utils/enum-labels";
import { formatBeijingDateTime } from "@/utils/datetime";
import {
  getApprovalDetail,
  type ApprovalDetailResponse,
  type ApprovalTask
} from "@/api/approval";
import {
  createContract,
  getAiReview,
  getContract,
  submitAmountChangeApproval,
  submitContractApproval,
  triggerAiReview,
  updateContract,
  type InstanceConfig,
  type ContractAmountChange,
  type ContractDetail
} from "@/api/contract";
import {
  listInvoiceRequests,
  listInvoices,
  listReceipts,
  type Invoice,
  type InvoiceRequest,
  type Receipt
} from "@/api/receipt";
import {
  createUploadSignature,
  resolveUploadUrl,
  signDownloadUrl
} from "@/api/upload";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import {
  isApprovalFinishedLocked,
  isApprovalInProgress
} from "../../shared/approvalLock";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import ReceiptDetailDrawer from "../../receipt/components/ReceiptDetailDrawer.vue";
import PaymentDetailDrawer from "../../payment/components/PaymentDetailDrawer.vue";
import {
  paymentStatusTagType,
  toPaymentStatusLabel
} from "../../payment/payment-labels";

defineOptions({ name: "ContractDetailPanel" });

const props = defineProps<{
  contractId?: number;
  initialDirection?: "inbound" | "outbound";
}>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "created", id: number): void;
  /** 面板内发起了页面级跳转（如去开票），宿主抽屉应随之关闭 */
  (e: "nav"): void;
}>();

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const loading = ref(false);
const saving = ref(false);
const submitApprovalLoading = ref(false);

type SubmitSnapshot = {
  fingerprint: string;
  idempotencyKey: string;
};

const submitApprovalSnapshot = ref<SubmitSnapshot | null>(null);

const createIdempotencyKey = (scope: string) => {
  const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallback;
  return `${scope}-${randomPart}`;
};

const getOrCreateSnapshotKey = (
  snapshot: SubmitSnapshot | null,
  fingerprint: string,
  scope: string
): SubmitSnapshot => {
  if (snapshot && snapshot.fingerprint === fingerprint) {
    return snapshot;
  }
  return {
    fingerprint,
    idempotencyKey: createIdempotencyKey(scope)
  };
};

const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const userStore = useUserStoreHook();
// 仅用于跳转导航（收款工作台），Panel 不读取路由参数
const router = useRouter();
const entities = ref<Entity[]>([]);
const entityBankAccountMap = ref<Record<number, EntityBankAccount[]>>({});
const detail = ref<ContractDetail | null>(null);

const form = ref({
  direction: "outbound",
  project_id: undefined as number | undefined,
  entity_id: undefined as number | undefined,
  counterparty: "",
  contract_type: "",
  handler_userid: "",
  contract_date: "",
  total_amount: 0,
  remark: ""
});

type ContractAttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

const attachmentItems = ref<ContractAttachmentDraft[]>([]);
const uploadingAttachment = ref(false);

const aiReviewData = ref<Record<string, unknown> | null>(null);
const aiStatus = ref("none");
const aiStatusTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};
const aiStatusLabelMap: Record<string, string> = {
  none: "未触发",
  pending: "审查中",
  completed: "已完成",
  failed: "失败"
};

const contractStatusTagType: Record<string, TagType> = {
  draft: "info",
  pending_review: "warning",
  pending_approval: "warning",
  active: "success",
  completed: "primary",
  terminated: "danger"
};

const contractStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审查",
  pending_approval: "待审批",
  active: "生效中",
  completed: "已完成",
  terminated: "已终止"
};

const bizStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending: "待处理",
  in_progress: "审批中",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已取消",
  withdrawn: "已撤回",
  paid: "已支付",
  completed: "已完成",
  failed: "失败"
};

const toBizStatusLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return bizStatusLabelMap[value] ?? value;
};

const amountChangeStatusTagType = (
  status: string | null | undefined
): TagType => {
  if (status === "pending") return "warning";
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "info";
};

const toAiStatusLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return aiStatusLabelMap[value] ?? value;
};

const isCreate = computed(() => props.contractId === undefined);
const contractId = computed(() => props.contractId ?? Number.NaN);
const inApprovalFlow = computed(() =>
  isApprovalInProgress(detail.value?.status)
);
const approvalFinishedLock = computed(() =>
  isApprovalFinishedLocked({
    isCreate: isCreate.value,
    approvalInstanceId: detail.value?.approval_instance_id,
    bizStatus: detail.value?.status,
    unlockedStatuses: ["draft"]
  })
);
const superEditMode = ref(false);
const superEditNote = ref("");
const canEdit = computed(
  () =>
    isCreate.value ||
    (!inApprovalFlow.value && !approvalFinishedLock.value) ||
    (isSuperAdmin.value && superEditMode.value)
);
const remainingAmount = computed(() => {
  if (!detail.value) return 0;
  return detail.value.total_amount - detail.value.paid_amount;
});

const editing = ref(false);
const isEditing = computed(() => isCreate.value || editing.value);

const paidPercentage = computed(() => {
  const total = detail.value?.total_amount ?? 0;
  const paid = detail.value?.paid_amount ?? 0;
  return total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
});
const isOverPaid = computed(() => {
  if (!detail.value) return false;
  return detail.value.paid_amount > detail.value.total_amount;
});

const projectName = computed(() => {
  const id = detail.value?.project_id;
  if (!id) return "-";
  return projects.value.find(item => item.id === id)?.project_name ?? `#${id}`;
});

const handlerName = computed(() => {
  const userid = detail.value?.handler_userid;
  if (!userid) return "-";
  return wecomUsers.value.find(item => item.userid === userid)?.name ?? userid;
});

type ContractPaymentRequest = ContractDetail["payment_requests"][number];

const paymentRequests = computed<ContractPaymentRequest[]>(
  () => detail.value?.payment_requests ?? []
);
const paymentTotalAmount = computed(() =>
  paymentRequests.value.reduce((sum, item) => sum + item.amount, 0)
);

const activePaymentId = ref<number | null>(null);
const paymentDrawerVisible = ref(false);

// ===== 收款合同（inbound）：开票记录 + 收款登记 =====
const invoiceRequests = ref<InvoiceRequest[]>([]);
const invoices = ref<Invoice[]>([]);
const receipts = ref<Receipt[]>([]);

const isInbound = computed(() => detail.value?.direction === "inbound");

// 开票申请/正式发票共用一套状态口径（键覆盖后端两套枚举全集，文案与 invoice.vue 一致）
const invoiceStatusTagTypeMap: Record<string, TagType> = {
  draft: "info",
  submitted: "warning",
  pending_approval: "warning",
  approved: "primary",
  ready_to_issue: "warning",
  issued: "success",
  rejected: "danger",
  cancelled: "info",
  red_issued: "warning",
  voided: "info"
};
const invoiceStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  pending_approval: "审批中",
  approved: "已通过",
  ready_to_issue: "待签发",
  issued: "已签发",
  rejected: "已驳回",
  cancelled: "已取消",
  red_issued: "已红冲",
  voided: "已作废"
};
const toInvoiceStatusTagType = (value: string): TagType =>
  invoiceStatusTagTypeMap[value] ?? "info";
const toInvoiceStatusLabel = (value: string) =>
  invoiceStatusLabelMap[value] ?? statusLabel(value);

const receiptStatusTagTypeMap: Record<string, TagType> = {
  recorded: "success",
  partial_refunded: "warning",
  refunded: "info"
};
const toReceiptStatusTagType = (value: string): TagType =>
  receiptStatusTagTypeMap[value] ?? "info";

const invoicedPercentage = computed(() => {
  const total = detail.value?.total_amount ?? 0;
  const invoiced = detail.value?.invoiced_amount ?? 0;
  return total > 0 ? Math.min(100, Math.round((invoiced / total) * 100)) : 0;
});
const isOverInvoiced = computed(() => {
  if (!detail.value) return false;
  return detail.value.invoiced_amount > detail.value.total_amount;
});
const receivedPercentage = computed(() => {
  const total = detail.value?.total_amount ?? 0;
  const received = detail.value?.received_amount ?? 0;
  return total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
});
const isOverReceived = computed(() => {
  if (!detail.value) return false;
  return detail.value.received_amount > detail.value.total_amount;
});

// 仅 inbound 拉取；isCreate/outbound 时清空并跳过
const loadInboundRecords = async () => {
  if (isCreate.value || !isInbound.value) {
    invoiceRequests.value = [];
    invoices.value = [];
    receipts.value = [];
    return;
  }
  const [requestRes, invoiceRes, receiptRes] = await Promise.all([
    listInvoiceRequests({ contract_id: contractId.value, pageSize: 100 }),
    listInvoices({ contract_id: contractId.value, pageSize: 100 }),
    listReceipts({ contract_id: contractId.value, pageSize: 100 })
  ]);
  invoiceRequests.value = requestRes.data;
  invoices.value = invoiceRes.data;
  receipts.value = receiptRes.data;
};

// 在途开票申请：已签发/已驳回/已取消的申请属于历史，不再算在途（与项目收款全貌口径一致）
const pendingInvoiceRequests = computed(() =>
  invoiceRequests.value.filter(
    item =>
      item.status !== "issued" &&
      item.status !== "rejected" &&
      item.status !== "cancelled"
  )
);

const activeReceiptId = ref<number | null>(null);
const receiptDrawerVisible = ref(false);

const openReceiptDrawer = (id: number) => {
  activeReceiptId.value = id;
  receiptDrawerVisible.value = true;
};

const onReceiptDrawerClosed = async () => {
  activeReceiptId.value = null;
  // 收款登记可能在抽屉里发生变化，重载详情以刷新 received_amount 等口径
  await loadDetail();
};

const goInvoiceWorkbench = () => {
  router.push("/finance/receipt/workbench?step=invoice");
  emit("nav");
};

const goReceiptWorkbench = () => {
  router.push("/finance/receipt/workbench?step=receipt");
  emit("nav");
};

const openPaymentDrawer = (id: number) => {
  activePaymentId.value = id;
  paymentDrawerVisible.value = true;
};

const onPaymentRowClick = (row: ContractPaymentRequest) => {
  openPaymentDrawer(row.id);
};

const onPaymentDrawerClosed = async () => {
  activePaymentId.value = null;
  await loadDetail();
};

const amountInput = computed({
  get: () =>
    Number.isFinite(form.value.total_amount)
      ? String(form.value.total_amount)
      : "",
  set: (value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      form.value.total_amount = 0;
      return;
    }
    const parsed = Number.parseFloat(normalized);
    form.value.total_amount = Number.isFinite(parsed) ? parsed : 0;
  }
});

const amountUppercase = computed(() =>
  toChineseAmount(form.value.total_amount)
);
const amountDisplay = computed(() => {
  const value = Number(form.value.total_amount || 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${amountUppercase.value}）`;
});
const selectedEntity = computed(
  () => entities.value.find(item => item.id === form.value.entity_id) ?? null
);
const selectedEntityAccount = computed(() => {
  const entityId = form.value.entity_id;
  if (!entityId) return null;
  const accounts = entityBankAccountMap.value[entityId] ?? [];
  return accounts.find(item => item.status === "active") ?? accounts[0] ?? null;
});

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

const parseAttachments = (
  raw: string | null | undefined
): ContractAttachmentDraft[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: Array<ContractAttachmentDraft | null> = parsed.map(item => {
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
    return items.filter(
      (item): item is ContractAttachmentDraft => item !== null
    );
  } catch {
    return [];
  }
};

const serializeAttachments = (): string => {
  return JSON.stringify(
    attachmentItems.value.map(item => ({
      file_key: item.file_key,
      file_name: item.file_name,
      file_size: item.file_size ?? undefined
    }))
  );
};

const fileUrl = (fileKey: string) =>
  resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);

const openAttachment = async (fileKey: string) => {
  try {
    const res = await signDownloadUrl(fileKey);
    window.open(resolveUploadUrl(res.data.url), "_blank");
  } catch {
    window.open(fileUrl(fileKey), "_blank");
  }
};

const approvalDialogVisible = ref(false);
const approvalSummary = ref("");
const approvalConfigText = ref("{}");
const approvalConfigMode = ref<"form" | "json">("form");
const approvalFormConfig = ref({
  default_assignee_userids: [] as string[],
  note: ""
});
const approvalNoteTemplates = [
  "请优先审批，业务节点加急。",
  "合同资料已补齐，请按标准流程审批。",
  "金额与条款已复核通过，请确认。",
  "附件已更新到最新版本，请以最新附件为准。"
];
const selectedApprovalNoteTemplate = ref("");
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const applyApprovalNoteTemplate = (value: string) => {
  if (!value) return;
  approvalFormConfig.value.note = value;
};

const loadBaseData = async () => {
  const [entityRes] = await Promise.all([
    listEntities(),
    loadProjects(),
    loadWecomUsers()
  ]);
  entities.value = entityRes.data;
  const entries = await Promise.all(
    entityRes.data.map(async item => {
      const accountRes = await listEntityBankAccounts(item.id).catch(() => ({
        data: []
      }));
      return [item.id, accountRes.data] as const;
    })
  );
  entityBankAccountMap.value = Object.fromEntries(entries);
};

const syncFormFromDetail = (data: ContractDetail) => {
  form.value = {
    direction: data.direction,
    project_id: data.project_id,
    entity_id: data.entity_id,
    counterparty: data.counterparty,
    contract_type: data.contract_type,
    handler_userid: data.handler_userid,
    contract_date: data.contract_date,
    total_amount: data.total_amount,
    remark: data.remark ?? ""
  };
};

// ===== 审批信息（驳回后合同状态会退回 draft，审批实例是唯一能看到驳回原因的地方） =====
const approvalDetail = ref<ApprovalDetailResponse | null>(null);

const approvalInstanceStatusLabelMap: Record<string, string> = {
  pending: "待处理",
  in_progress: "审批中",
  approved: "已通过",
  rejected: "已驳回",
  returned: "已退回",
  cancelled: "已取消",
  withdrawn: "已撤回",
  completed: "已完成"
};

const approvalInstanceStatusTagTypeMap: Record<string, TagType> = {
  pending: "warning",
  in_progress: "warning",
  approved: "success",
  rejected: "danger",
  returned: "warning",
  cancelled: "info",
  withdrawn: "info",
  completed: "success"
};

const toApprovalInstanceStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return approvalInstanceStatusLabelMap[status] ?? status;
};

const toApprovalInstanceStatusTagType = (
  status: string | null | undefined
): TagType =>
  status ? (approvalInstanceStatusTagTypeMap[status] ?? "info") : "info";

const approvalActionLabelMap: Record<string, string> = {
  approve: "通过",
  reject: "驳回",
  return_initiator: "退回发起人",
  return_prev: "退回上一步",
  return_to: "退回指定节点",
  transfer: "转办"
};

const toApprovalActionLabel = (action: string | null) => {
  if (!action) return "待处理";
  return approvalActionLabelMap[action] ?? action;
};

const toApprovalUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  if (userid === "AI_GATE") return "AI审查";
  return wecomUsers.value.find(item => item.userid === userid)?.name ?? userid;
};

const commentedApprovalTasks = computed<ApprovalTask[]>(() => {
  const tasks = approvalDetail.value?.tasks ?? [];
  return tasks
    .filter(task => task.action !== null && Boolean(task.comment))
    .sort((a, b) =>
      (a.acted_at ?? a.created_at).localeCompare(b.acted_at ?? b.created_at)
    );
});

const latestRejectAlertText = computed(() => {
  const rejects = commentedApprovalTasks.value.filter(
    task => task.action === "reject"
  );
  const latest = rejects.length > 0 ? rejects[rejects.length - 1] : null;
  if (!latest?.comment) return "";
  return `${toApprovalUserLabel(latest.assignee_userid)}：${latest.comment}`;
});

const loadApprovalDetail = async (approvalInstanceId: number | null) => {
  if (!approvalInstanceId) {
    approvalDetail.value = null;
    return;
  }
  try {
    const result = await getApprovalDetail(approvalInstanceId);
    approvalDetail.value = result.data;
  } catch {
    // 审批详情拉取失败不阻塞合同页，仅隐藏审批信息段
    approvalDetail.value = null;
  }
};

const goToApprovalDetail = () => {
  const approvalInstanceId = detail.value?.approval_instance_id;
  if (!approvalInstanceId) return;
  router.push(`/approval/detail/${approvalInstanceId}`);
  emit("nav");
};

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getContract(contractId.value);
    detail.value = result.data;
    syncFormFromDetail(result.data);
    superEditMode.value = false;
    superEditNote.value = "";
    attachmentItems.value = parseAttachments(result.data.attachments_json);
    await Promise.all([
      loadAiReview(),
      loadInboundRecords(),
      loadApprovalDetail(result.data.approval_instance_id)
    ]);
  } finally {
    loading.value = false;
  }
};

const loadAiReview = async () => {
  if (isCreate.value) return;
  const result = await getAiReview(contractId.value);
  aiStatus.value = result.data.status;
  aiReviewData.value = result.data.result;
};

const enterEdit = () => {
  if (!canEdit.value) {
    message("当前状态不可编辑；如需修改请联系超管开启编辑模式", {
      type: "warning"
    });
    return;
  }
  editing.value = true;
};

const cancelEdit = () => {
  if (detail.value) {
    syncFormFromDetail(detail.value);
    attachmentItems.value = parseAttachments(detail.value.attachments_json);
  }
  editing.value = false;
};

const onSave = async () => {
  if (!canEdit.value) {
    message("审批结束后仅允许补充附件；如需修改请联系超管开启编辑模式", {
      type: "warning"
    });
    return;
  }

  if (
    !form.value.project_id ||
    !form.value.entity_id ||
    !form.value.counterparty
  ) {
    message("请先填写必填项", { type: "warning" });
    return;
  }

  if (
    isSuperAdmin.value &&
    superEditMode.value &&
    !superEditNote.value.trim()
  ) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    if (isCreate.value) {
      const result = await createContract({
        direction: form.value.direction,
        project_id: form.value.project_id,
        entity_id: form.value.entity_id,
        counterparty: form.value.counterparty,
        contract_type: form.value.contract_type,
        handler_userid: form.value.handler_userid,
        contract_date: form.value.contract_date,
        total_amount: form.value.total_amount,
        attachments_json: serializeAttachments(),
        remark: form.value.remark
      });
      message("合同创建成功", { type: "success" });
      emit("created", result.data.id);
      return;
    }
    await updateContract(contractId.value, {
      counterparty: form.value.counterparty,
      contract_type: form.value.contract_type,
      handler_userid: form.value.handler_userid,
      contract_date: form.value.contract_date,
      total_amount: form.value.total_amount,
      attachments_json: serializeAttachments(),
      remark: form.value.remark,
      admin_edit_mode:
        isSuperAdmin.value && superEditMode.value ? true : undefined,
      edit_note:
        isSuperAdmin.value && superEditMode.value
          ? superEditNote.value.trim() || undefined
          : undefined
    });
    message("保存成功", { type: "success" });
    editing.value = false;
    await loadDetail();
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const onSubmitApproval = async () => {
  if (isCreate.value) {
    message("请先保存合同", { type: "warning" });
    return;
  }
  approvalSummary.value = detail.value?.contract_no
    ? `${detail.value.contract_no} | ${detail.value.counterparty} | ${detail.value.total_amount}`
    : "";
  approvalConfigMode.value = "form";
  approvalFormConfig.value = {
    default_assignee_userids: [],
    note: ""
  };
  selectedApprovalNoteTemplate.value = "";
  approvalConfigText.value = "{}";
  approvalDialogVisible.value = true;
};

const confirmSubmitApproval = async () => {
  if (isCreate.value || submitApprovalLoading.value) return;

  let instanceConfig: InstanceConfig | undefined;
  if (approvalConfigMode.value === "json") {
    const trimmed = approvalConfigText.value.trim();
    if (trimmed && trimmed !== "{}") {
      try {
        instanceConfig = JSON.parse(trimmed) as InstanceConfig;
      } catch {
        message("实例级配置 JSON 格式不正确", { type: "warning" });
        return;
      }
    }
  } else {
    const pickedUserIds =
      approvalFormConfig.value.default_assignee_userids.filter(Boolean);
    const note = approvalFormConfig.value.note.trim();
    if (pickedUserIds.length > 0 || note) {
      instanceConfig = {
        ...(pickedUserIds.length > 0
          ? { default_assignee_userids: pickedUserIds }
          : {}),
        ...(note ? { note } : {})
      };
    }
  }

  const summary = approvalSummary.value.trim();
  const submitFingerprint = JSON.stringify({
    contract_id: contractId.value,
    biz_summary: summary,
    instance_config: instanceConfig ?? null
  });
  const snapshot = getOrCreateSnapshotKey(
    submitApprovalSnapshot.value,
    submitFingerprint,
    "contract-detail-submit"
  );
  submitApprovalSnapshot.value = snapshot;

  submitApprovalLoading.value = true;
  try {
    await submitContractApproval(
      contractId.value,
      {
        biz_summary: summary || undefined,
        instance_config: instanceConfig
      },
      {
        idempotencyKey: snapshot.idempotencyKey
      }
    );
    submitApprovalSnapshot.value = null;
    approvalDialogVisible.value = false;
    message("已提交审批", { type: "success" });
    await loadDetail();
  } catch {
    message("提交审批失败，请重试", { type: "error" });
  } finally {
    submitApprovalLoading.value = false;
  }
};

const onTriggerAiReview = async () => {
  if (isCreate.value) {
    message("请先保存合同", { type: "warning" });
    return;
  }
  await triggerAiReview(contractId.value);
  message("已触发AI审查", { type: "success" });
  await loadAiReview();
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  if (isCreate.value && !canEdit.value) {
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
      category: "contract"
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
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size
    });

    // 编辑态附件跟随「保存」一并提交；非编辑态（含锁定补传）上传即落库
    if (!isCreate.value && !isEditing.value) {
      await updateContract(contractId.value, {
        attachments_json: serializeAttachments()
      });
    }

    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingAttachment.value = false;
  }
};

const removeAttachment = async (index: number) => {
  if (!canEdit.value) return;
  attachmentItems.value.splice(index, 1);
  if (isCreate.value || isEditing.value) return;
  try {
    await updateContract(contractId.value, {
      attachments_json: serializeAttachments()
    });
    message("附件已移除", { type: "success" });
  } catch {
    message("附件移除失败", { type: "error" });
    await loadDetail();
  }
};

const onSubmitAmountChange = async (row: ContractAmountChange) => {
  if (isCreate.value) return;
  await submitAmountChangeApproval(contractId.value, row.id);
  message("金额变更已提交审批", { type: "success" });
  await loadDetail();
};

const goBack = () => {
  emit("back");
};

onMounted(async () => {
  loading.value = true;
  try {
    if (isCreate.value && props.initialDirection) {
      form.value.direction = props.initialDirection;
    }
    await loadBaseData();
    await loadDetail();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="contract-detail-panel">
    <FinanceDetailHeader
      v-if="!isCreate"
      serial-label="合同号"
      :serial="detail?.contract_no ?? null"
      amount-label="合同金额"
      :amount="detail?.total_amount ?? null"
      :amount-cn="detail ? toChineseAmount(detail.total_amount) : null"
    >
      <template #tags>
        <el-tag
          v-if="detail"
          :type="detail.direction === 'outbound' ? 'warning' : 'success'"
        >
          {{ detail.direction === "outbound" ? "对外付款" : "收款" }}
        </el-tag>
        <el-tag
          v-if="detail"
          :type="contractStatusTagType[detail.status] || 'info'"
        >
          {{ contractStatusLabelMap[detail.status] || detail.status }}
        </el-tag>
        <el-tag :type="aiStatusTagType[aiStatus] || 'info'">
          AI审查：{{ toAiStatusLabel(aiStatus) }}
        </el-tag>
        <el-tag v-if="detail?.legacy_data_id" size="small" type="info">
          历史数据
        </el-tag>
      </template>
      <template #meta>
        <span>所属项目：{{ projectName }}</span>
        <span>对方单位：{{ detail?.counterparty || "-" }}</span>
        <span>
          合同类型：{{
            detail?.contract_type
              ? contractTypeLabel(detail.contract_type)
              : "-"
          }}
        </span>
        <span>合同日期：{{ detail?.contract_date || "-" }}</span>
        <span>经办人：{{ handlerName }}</span>
      </template>
      <template #actions>
        <el-button
          v-if="!editing && canEdit"
          type="primary"
          plain
          @click="enterEdit"
        >
          编辑资料
        </el-button>
        <el-button
          type="warning"
          plain
          :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
          @click="onSubmitApproval"
        >
          提交审批
        </el-button>
        <el-button
          type="success"
          plain
          :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
          @click="onTriggerAiReview"
        >
          触发AI审查
        </el-button>
        <el-button @click="goBack">返回</el-button>
      </template>
      <template #extra>
        <div v-if="detail && isInbound" class="pay-progress">
          <div class="pay-progress__figures">
            <span>
              已开票
              <b class="mono">{{ formatMoney(detail.invoiced_amount) }}</b>
              /
              <b class="mono">{{ formatMoney(detail.total_amount) }}</b>
            </span>
          </div>
          <el-progress
            :percentage="invoicedPercentage"
            :stroke-width="8"
            :color="isOverInvoiced ? '' : '#c9a35c'"
            :status="isOverInvoiced ? 'exception' : ''"
          />
          <div class="pay-progress__figures" style="margin-top: 8px">
            <span>
              已到账
              <b class="mono">{{ formatMoney(detail.received_amount) }}</b>
              /
              <b class="mono">{{ formatMoney(detail.total_amount) }}</b>
            </span>
          </div>
          <el-progress
            :percentage="receivedPercentage"
            :stroke-width="8"
            :color="isOverReceived ? '' : '#c9a35c'"
            :status="isOverReceived ? 'exception' : ''"
          />
        </div>
        <div v-else-if="detail" class="pay-progress">
          <div class="pay-progress__figures">
            <span>
              合同总额
              <b class="mono">{{ formatMoney(detail.total_amount) }}</b>
            </span>
            <span>
              已付
              <b class="mono">{{ formatMoney(detail.paid_amount) }}</b>
            </span>
            <span>
              剩余
              <b class="mono">{{ formatMoney(remainingAmount) }}</b>
            </span>
          </div>
          <el-progress
            :percentage="paidPercentage"
            :stroke-width="8"
            :color="isOverPaid ? '' : '#c9a35c'"
            :status="isOverPaid ? 'exception' : ''"
          />
        </div>
      </template>
    </FinanceDetailHeader>

    <header v-else class="create-masthead">
      <span class="create-masthead__title">新建合同</span>
      <el-button @click="goBack">返回</el-button>
    </header>

    <el-alert
      v-if="inApprovalFlow"
      title="当前合同处于审批流程中，详情字段已锁定"
      type="warning"
      :closable="false"
      style="margin-bottom: 12px"
    />

    <el-alert
      v-if="approvalFinishedLock"
      title="审批流程已结束：仅允许补充附件。合同金额如需调整，请发起金额变更。"
      type="info"
      :closable="false"
      style="margin-bottom: 12px"
    />

    <el-form
      v-if="isSuperAdmin && !isCreate"
      inline
      style="margin-bottom: 10px"
    >
      <el-form-item label="超管编辑模式">
        <el-switch v-model="superEditMode" />
      </el-form-item>
      <el-form-item label="修改说明">
        <el-input
          v-model="superEditNote"
          :disabled="!superEditMode"
          placeholder="开启后必填，将写入备注留痕"
          style="width: 380px"
        />
      </el-form-item>
    </el-form>

    <el-alert
      v-if="isSuperAdmin && superEditMode"
      title="超管编辑模式已开启：保存业务字段时将强制要求修改说明，并把留痕写入备注。"
      type="warning"
      :closable="false"
      style="margin-bottom: 12px"
    />

    <FinSection v-if="isEditing" title="合同信息">
      <el-form label-width="110px" style="max-width: 900px">
        <el-form-item label="合同方向">
          <el-radio-group
            v-model="form.direction"
            :disabled="!isCreate && !canEdit"
          >
            <el-radio label="outbound">对外付款</el-radio>
            <el-radio label="inbound">收款</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="所属项目">
          <el-select
            v-model="form.project_id"
            filterable
            clearable
            style="width: 360px"
            :disabled="!isCreate && !canEdit"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :value="item.id"
              :label="item.project_name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="我方主体">
          <div style="width: 100%">
            <el-select
              v-model="form.entity_id"
              filterable
              clearable
              style="width: 360px"
              :disabled="!isCreate && !canEdit"
            >
              <el-option
                v-for="item in entities"
                :key="item.id"
                :value="item.id"
                :label="item.entity_name"
              />
            </el-select>
            <div
              v-if="selectedEntity"
              style="margin-top: 6px; color: #6e6458; font-size: 13px"
            >
              {{ selectedEntity.entity_name }}
              <span v-if="selectedEntityAccount">
                | {{ selectedEntityAccount.bank_name }} /
                {{ selectedEntityAccount.account_no }}
              </span>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="对方单位">
          <el-input
            v-model="form.counterparty"
            :disabled="!canEdit"
            placeholder="请输入对方单位"
          />
        </el-form-item>
        <el-form-item label="合同类型">
          <el-select
            v-model="form.contract_type"
            clearable
            style="width: 220px"
            :disabled="!canEdit"
          >
            <el-option label="人工" value="人工" />
            <el-option label="机械" value="机械" />
            <el-option label="总包" value="总包" />
            <el-option label="材料" value="材料" />
            <el-option label="其他" value="其他" />
          </el-select>
        </el-form-item>
        <el-form-item label="经办人">
          <el-select
            v-model="form.handler_userid"
            clearable
            filterable
            placeholder="选择公司人员"
            style="width: 360px"
            :disabled="!canEdit"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="item.name"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="合同日期">
          <el-date-picker
            v-model="form.contract_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            :disabled="!canEdit"
          />
        </el-form-item>
        <el-form-item label="合同金额">
          <div
            style="display: flex; align-items: center; gap: 12px; width: 100%"
          >
            <el-input
              v-model="amountInput"
              type="number"
              placeholder="请输入金额"
              style="max-width: 260px"
              :disabled="!canEdit"
            />
            <span style="font-weight: 700; color: #6b4f2a">{{
              amountDisplay
            }}</span>
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            :disabled="!canEdit"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!canEdit"
            @click="onSave"
          >
            保存
          </el-button>
          <el-button v-if="!isCreate" :disabled="saving" @click="cancelEdit">
            取消编辑
          </el-button>
        </el-form-item>
      </el-form>
    </FinSection>

    <FinSection v-else title="合同信息">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="所属项目">
          {{ projectName }}
        </el-descriptions-item>
        <el-descriptions-item label="我方主体">
          <template v-if="selectedEntity">
            {{ selectedEntity.entity_name }}
            <span v-if="selectedEntityAccount">
              （{{ selectedEntityAccount.bank_name }} /
              {{ selectedEntityAccount.account_no }}）
            </span>
          </template>
          <template v-else>-</template>
        </el-descriptions-item>
        <el-descriptions-item label="对方单位">
          {{ detail?.counterparty || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="合同类型">
          {{
            detail?.contract_type
              ? contractTypeLabel(detail.contract_type)
              : "-"
          }}
        </el-descriptions-item>
        <el-descriptions-item label="经办人">
          {{ handlerName }}
        </el-descriptions-item>
        <el-descriptions-item label="合同日期">
          {{ detail?.contract_date || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">
          {{ detail?.remark || "-" }}
        </el-descriptions-item>
      </el-descriptions>
    </FinSection>

    <FinSection title="合同附件">
      <div class="attachment-upload">
        <el-upload
          drag
          action="#"
          :show-file-list="false"
          :disabled="uploadingAttachment || inApprovalFlow"
          :http-request="uploadAttachment"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
        >
          <div class="el-upload__text">
            拖拽文件到这里，或 <em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              支持常见文档和图片，上传后可预览/下载
            </div>
          </template>
        </el-upload>
      </div>

      <el-table :data="attachmentItems" size="small" style="margin-top: 12px">
        <el-table-column label="文件名" min-width="260">
          <template #default="scope">{{ scope.row.file_name }}</template>
        </el-table-column>
        <el-table-column label="大小" width="120">
          <template #default="scope">{{ scope.row.file_size ?? "-" }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-link type="primary" @click="openAttachment(scope.row.file_key)">
              预览
            </el-link>
            <el-link
              type="success"
              style="margin-left: 12px"
              @click="openAttachment(scope.row.file_key)"
            >
              下载
            </el-link>
            <el-button
              link
              type="danger"
              style="margin-left: 12px"
              :disabled="!canEdit"
              @click="removeAttachment(scope.$index)"
            >
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </FinSection>

    <template v-if="!isEditing">
      <FinSection
        v-if="approvalDetail || detail?.approval_instance_id"
        title="审批信息"
      >
        <template #extra>
          <el-button
            v-if="detail?.approval_instance_id"
            type="info"
            plain
            size="small"
            @click="goToApprovalDetail"
          >
            查看审批详情
          </el-button>
        </template>

        <el-alert
          v-if="
            approvalDetail?.instance.status === 'rejected' &&
            latestRejectAlertText
          "
          type="error"
          :closable="false"
          show-icon
          title="审批已驳回"
          :description="latestRejectAlertText"
          style="margin-bottom: 12px"
        />

        <el-descriptions v-if="approvalDetail" :column="2" border>
          <el-descriptions-item label="审批单号">
            {{ approvalDetail.instance.instance_no }}
          </el-descriptions-item>
          <el-descriptions-item label="审批状态">
            <el-tag
              :type="
                toApprovalInstanceStatusTagType(approvalDetail.instance.status)
              "
            >
              {{
                toApprovalInstanceStatusLabel(approvalDetail.instance.status)
              }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="commentedApprovalTasks.length > 0" style="margin-top: 12px">
          <div
            v-for="task in commentedApprovalTasks"
            :key="task.id"
            style="margin-bottom: 4px"
          >
            {{ toApprovalUserLabel(task.assignee_userid) }}：{{
              toApprovalActionLabel(task.action)
            }}（{{ task.comment }}）
            <span style="color: var(--el-text-color-secondary)">
              {{ formatBeijingDateTime(task.acted_at ?? task.created_at) }}
            </span>
          </div>
        </div>
      </FinSection>

      <!-- v-if 只判"合同已加载"（新建态无报告可言）；报告为空/审查中的占位由子组件出 -->
      <FinSection v-if="detail" title="AI审查报告">
        <AiReviewReport
          kind="contract"
          :source="aiReviewData"
          :status="aiStatus"
        />
      </FinSection>

      <FinSection v-if="detail" title="金额变更记录">
        <el-table :data="detail.amount_changes" size="small">
          <el-table-column prop="created_at" label="创建时间" width="180" />
          <el-table-column prop="change_type" label="类型" width="100" />
          <el-table-column label="原金额" width="130" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.old_amount) }}
            </template>
          </el-table-column>
          <el-table-column label="新金额" width="130" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.new_amount) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="scope">
              <el-tag :type="amountChangeStatusTagType(scope.row.status)">
                {{ toBizStatusLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reason" label="原因" min-width="220" />
          <el-table-column label="附件" min-width="180">
            <template #default="scope">
              <template v-if="scope.row.attachments?.length">
                <div v-for="item in scope.row.attachments" :key="item.file_key">
                  <el-link
                    type="primary"
                    :title="item.file_name"
                    @click="openAttachment(item.file_key)"
                  >
                    {{ item.file_name }}
                  </el-link>
                </div>
              </template>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button
                v-if="scope.row.status === 'pending'"
                link
                type="primary"
                @click="onSubmitAmountChange(scope.row)"
              >
                提交审批
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </FinSection>

      <!-- 收款合同不存在对外付款，仅 outbound 展示 -->
      <FinSection
        v-if="detail && detail.direction === 'outbound'"
        title="关联付款申请"
      >
        <template #extra>
          <span class="section-stat">
            共 {{ paymentRequests.length }} 笔 / 合计
            {{ formatMoney(paymentTotalAmount) }}
          </span>
        </template>
        <el-table
          v-if="paymentRequests.length"
          class="payment-table"
          :data="paymentRequests"
          size="small"
          @row-click="onPaymentRowClick"
        >
          <el-table-column label="流水号" min-width="170">
            <template #default="scope">
              <span class="mono">{{ scope.row.serial_no }}</span>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="140" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.amount) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="scope">
              <el-tag :type="paymentStatusTagType[scope.row.status] || 'info'">
                {{ toPaymentStatusLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="180" />
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="scope">
              <el-button
                link
                type="primary"
                @click.stop="openPaymentDrawer(scope.row.id)"
              >
                查看
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无关联付款" :image-size="64" />
      </FinSection>
    </template>

    <!-- 收款合同专属：开票记录 / 收款登记（阅读态与编辑态均展示） -->
    <FinSection v-if="detail && isInbound" title="开票记录">
      <template #extra>
        <span class="section-stat">
          已开票合计 ¥{{ formatMoney(detail.invoiced_amount) }}
        </span>
        <el-button link type="primary" @click="goInvoiceWorkbench">
          去开票
        </el-button>
      </template>
      <template v-if="pendingInvoiceRequests.length || invoices.length">
        <div v-if="pendingInvoiceRequests.length" class="record-block">
          <div class="record-block__title">在途开票申请</div>
          <el-table :data="pendingInvoiceRequests" size="small">
            <el-table-column label="申请单号" min-width="170">
              <template #default="scope">
                <span class="mono">{{ scope.row.request_no }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="invoice_category"
              label="发票类目"
              min-width="140"
            />
            <el-table-column label="含税金额" width="140" align="right">
              <template #default="scope">
                {{ formatMoney(scope.row.amount_with_tax) }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="scope">
                <el-tag :type="toInvoiceStatusTagType(scope.row.status)">
                  {{ toInvoiceStatusLabel(scope.row.status) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div v-if="invoices.length" class="record-block">
          <div class="record-block__title">正式发票</div>
          <el-table :data="invoices" size="small">
            <el-table-column label="发票单号" min-width="170">
              <template #default="scope">
                <span class="mono">{{ scope.row.invoice_no }}</span>
              </template>
            </el-table-column>
            <el-table-column label="含税金额" width="140" align="right">
              <template #default="scope">
                {{ formatMoney(scope.row.amount_with_tax ?? scope.row.amount) }}
              </template>
            </el-table-column>
            <el-table-column prop="issue_date" label="开票日期" width="130" />
            <el-table-column label="状态" width="110">
              <template #default="scope">
                <el-tag :type="toInvoiceStatusTagType(scope.row.status)">
                  {{ toInvoiceStatusLabel(scope.row.status) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </template>
      <el-empty v-else description="暂无开票记录" :image-size="64" />
    </FinSection>

    <FinSection v-if="detail && isInbound" title="收款登记">
      <template #extra>
        <span class="section-stat">
          已到账合计 ¥{{ formatMoney(detail.received_amount) }}
        </span>
        <el-button link type="primary" @click="goReceiptWorkbench">
          新增收款登记
        </el-button>
      </template>
      <el-table v-if="receipts.length" :data="receipts" size="small">
        <el-table-column label="收款单号" min-width="170">
          <template #default="scope">
            <span class="mono">{{ scope.row.receipt_no }}</span>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="140" align="right">
          <template #default="scope">
            {{ formatMoney(scope.row.amount) }}
          </template>
        </el-table-column>
        <el-table-column prop="received_date" label="到账日期" width="130" />
        <el-table-column label="收款账户" min-width="160">
          <template #default="scope">
            {{ scope.row.payment_account || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="scope">
            <el-tag :type="toReceiptStatusTagType(scope.row.status)">
              {{ statusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openReceiptDrawer(scope.row.id)"
            >
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="暂无收款登记" :image-size="64" />
    </FinSection>

    <el-dialog
      v-model="approvalDialogVisible"
      title="审批提交设置"
      width="560px"
      append-to-body
    >
      <el-alert
        type="info"
        :closable="false"
        title="推荐使用可视化方式设置临时审批人和审批说明；JSON 为超管高级模式"
        style="margin-bottom: 12px"
      />
      <el-form label-width="120px">
        <el-form-item label="审批摘要">
          <el-input
            v-model="approvalSummary"
            placeholder="可选，留空使用系统默认摘要"
          />
        </el-form-item>
        <el-form-item v-if="isSuperAdmin" label="设置模式">
          <el-radio-group v-model="approvalConfigMode">
            <el-radio-button value="form">可视化</el-radio-button>
            <el-radio-button value="json">JSON(高级)</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="approvalConfigMode === 'form'">
          <el-form-item label="临时审批人">
            <el-select
              v-model="approvalFormConfig.default_assignee_userids"
              multiple
              clearable
              filterable
              placeholder="可选，指定本次审批默认审批人"
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
          <el-form-item label="常用说明模板">
            <el-select
              v-model="selectedApprovalNoteTemplate"
              clearable
              placeholder="选择后自动填充审批说明"
              style="width: 100%"
              @change="applyApprovalNoteTemplate"
            >
              <el-option
                v-for="item in approvalNoteTemplates"
                :key="item"
                :label="item"
                :value="item"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="审批说明">
            <el-input
              v-model="approvalFormConfig.note"
              type="textarea"
              :rows="3"
              placeholder="可选，用于补充本次实例级说明"
            />
          </el-form-item>
        </template>
        <el-form-item v-else-if="isSuperAdmin" label="实例配置(JSON)">
          <el-input
            v-model="approvalConfigText"
            type="textarea"
            :rows="7"
            placeholder='例如 {"default_assignee_userids":["zhangsan"],"note":"加急审批"}'
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          :disabled="submitApprovalLoading"
          @click="approvalDialogVisible = false"
          >取消</el-button
        >
        <el-button
          type="primary"
          :loading="submitApprovalLoading"
          :disabled="submitApprovalLoading"
          @click="confirmSubmitApproval"
          >确认提交</el-button
        >
      </template>
    </el-dialog>

    <PaymentDetailDrawer
      v-model:visible="paymentDrawerVisible"
      :request-id="activePaymentId"
      @closed="onPaymentDrawerClosed"
    />

    <ReceiptDetailDrawer
      v-model:visible="receiptDrawerVisible"
      :receipt-id="activeReceiptId"
      @closed="onReceiptDrawerClosed"
    />
  </div>
</template>

<style scoped>
.contract-detail-panel {
  min-height: 240px;
}

.mono {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.create-masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: linear-gradient(180deg, #fffdf7 0%, #f9f1e0 100%);
  border: 1px solid #e3d5b8;
  border-radius: 10px;
}

.create-masthead__title {
  font-size: 16px;
  font-weight: 700;
  color: #3f3527;
}

.pay-progress__figures {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
  margin-bottom: 6px;
  font-size: 13px;
  color: #6e6458;
}

.pay-progress__figures b {
  color: #3f3527;
}

.section-stat {
  font-size: 12px;
  color: #8c6a2f;
}

.record-block + .record-block {
  margin-top: 14px;
}

.record-block__title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #8c6a2f;
}

.payment-table :deep(.el-table__row) {
  cursor: pointer;
}

.attachment-upload :deep(.el-upload-dragger) {
  padding: 16px 20px;
}
</style>
