<script setup lang="ts">
import { type UploadRequestOptions } from "element-plus";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import {
  submitPaymentApproval,
  triggerRiskAssessment,
  updatePaymentRequest,
  type Payee,
  type PaymentRequestDetail
} from "@/api/payment";
import type { Contract, InstanceConfig } from "@/api/contract";
import type { Entity, EntityBankAccount } from "@/api/entity";
import type { Project } from "@/api/project";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import type { WeComUser } from "@/api/wecom";
import { useUserStoreHook } from "@/store/modules/user";
import {
  isApprovalFinishedLocked,
  isApprovalInProgress
} from "../../shared/approvalLock";
import {
  formatBeijingDateTime,
  toPaymentMethodLabel,
  toPaymentStatusLabel
} from "../payment-labels";

defineOptions({ name: "PaymentInfoCard" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  contracts: Contract[];
  payees: Payee[];
  projects: Project[];
  entities: Entity[];
  entityBankAccountMap: Record<number, EntityBankAccount[]>;
  canEditFields: boolean;
  superEditMode: boolean;
  superEditNote: string;
  autoEdit: boolean;
  wecomUsers: WeComUser[];
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const route = useRoute();
const requestId = computed(() => Number(route.params.id));
const userStore = useUserStoreHook();

const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const inApprovalFlow = computed(() =>
  isApprovalInProgress(props.detail?.status)
);
const approvalFinishedLock = computed(() =>
  isApprovalFinishedLocked({
    isCreate: false,
    approvalInstanceId: props.detail?.approval_instance_id,
    bizStatus: props.detail?.status,
    unlockedStatuses: ["draft"]
  })
);

const saving = ref(false);
const submitApprovalLoading = ref(false);

const form = ref({
  contract_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  expected_payment_date: "",
  category: "其他费用",
  payee_id: undefined as number | undefined,
  amount: 0,
  content: "",
  payment_method: "对公转账",
  remark: ""
});

type PaymentAttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};
const attachmentItems = ref<PaymentAttachmentDraft[]>([]);
const uploadingAttachment = ref(false);

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

const toPaymentCategoryLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentCategoryLabelMap[value] ?? value;
};

const selectedContract = computed(() => {
  return (
    props.contracts.find(item => item.id === form.value.contract_id) ?? null
  );
});
const selectedPayee = computed(() => {
  return props.payees.find(item => item.id === form.value.payee_id) ?? null;
});
const projectName = computed(() => {
  const target = props.projects.find(
    item => item.id === form.value.project_id
  );
  return target ? `${target.project_name} (${target.project_code})` : "";
});
const selectedEntity = computed(() => {
  const entityId = selectedContract.value?.entity_id;
  if (!entityId) return null;
  return props.entities.find(item => item.id === entityId) ?? null;
});
const selectedEntityAccount = computed(() => {
  const entityId = selectedContract.value?.entity_id;
  if (!entityId) return null;
  const accounts = props.entityBankAccountMap[entityId] ?? [];
  return accounts.find(item => item.status === "active") ?? accounts[0] ?? null;
});

const remainingAmount = computed(() => {
  if (!selectedContract.value) return 0;
  return (
    selectedContract.value.total_amount - selectedContract.value.paid_amount
  );
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

const amountDisplay = computed(() => {
  const value = Number(form.value.amount || 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${toChineseAmount(value)}）`;
});

const remainingAmountDisplay = computed(() => {
  const value = Number(remainingAmount.value || 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${toChineseAmount(value)}）`;
});

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

const parseAttachments = (
  raw: string | null | undefined
): PaymentAttachmentDraft[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: Array<PaymentAttachmentDraft | null> = parsed.map(item => {
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
      (item): item is PaymentAttachmentDraft => item !== null
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
  "付款凭证已补齐，请审核通过。",
  "金额与收款信息已复核，请确认。",
  "请关注付款时效，审批完成后将立即执行打款。"
];
const selectedApprovalNoteTemplate = ref("");

const applyApprovalNoteTemplate = (value: string) => {
  if (!value) return;
  approvalFormConfig.value.note = value;
};

const onSelectContract = (contractId?: number) => {
  const selected = props.contracts.find(item => item.id === contractId);
  if (!selected) return;
  form.value.project_id = selected.project_id;
};

const onSave = async () => {
  if (!props.canEditFields) {
    message("审批结束后仅允许补充附件；如需修改请联系超管开启编辑模式", {
      type: "warning"
    });
    return;
  }

  if (
    isSuperAdmin.value &&
    props.superEditMode &&
    !props.superEditNote.trim()
  ) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return;
  }
  if (
    !form.value.contract_id ||
    !form.value.project_id ||
    !form.value.payee_id ||
    !form.value.expected_payment_date ||
    !form.value.category ||
    !form.value.payment_method ||
    !form.value.content.trim()
  ) {
    message("请完整填写付款审批字段", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    await updatePaymentRequest(requestId.value, {
      expected_payment_date: form.value.expected_payment_date,
      category: form.value.category,
      payee_id: form.value.payee_id,
      amount: form.value.amount,
      content: form.value.content,
      payment_method: form.value.payment_method,
      attachments_json: serializeAttachments(),
      remark: form.value.remark,
      admin_edit_mode:
        isSuperAdmin.value && props.superEditMode ? true : undefined,
      edit_note:
        isSuperAdmin.value && props.superEditMode
          ? props.superEditNote.trim() || undefined
          : undefined
    });
    message("保存成功", { type: "success" });
    emit("refresh");
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const onSubmitApproval = async () => {
  approvalSummary.value = props.detail?.serial_no
    ? `${props.detail.serial_no} | ${props.detail.content} | ${props.detail.amount}`
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
  if (submitApprovalLoading.value) return;

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
    request_id: requestId.value,
    biz_summary: summary,
    instance_config: instanceConfig ?? null
  });
  submitApprovalSnapshot.value = getOrCreateSnapshotKey(
    submitApprovalSnapshot.value,
    submitFingerprint,
    "payment-detail-submit"
  );

  submitApprovalLoading.value = true;
  try {
    await submitPaymentApproval(
      requestId.value,
      {
        biz_summary: summary || undefined,
        instance_config: instanceConfig
      },
      {
        idempotencyKey: submitApprovalSnapshot.value.idempotencyKey
      }
    );
    submitApprovalSnapshot.value = null;
    approvalDialogVisible.value = false;
    message("已提交审批", { type: "success" });
    emit("refresh");
  } catch {
    message("提交审批失败，请重试", { type: "error" });
  } finally {
    submitApprovalLoading.value = false;
  }
};

const onRiskAssessment = async () => {
  await triggerRiskAssessment(requestId.value);
  message("已触发风险评估", { type: "success" });
  emit("refresh");
};

const persistAttachments = async () => {
  await updatePaymentRequest(requestId.value, {
    attachments_json: serializeAttachments()
  });
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingAttachment.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "payment"
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
    await persistAttachments();
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
  if (inApprovalFlow.value) {
    message("审批中仅允许新增附件，不允许删除", { type: "warning" });
    return;
  }
  if (
    approvalFinishedLock.value &&
    !(isSuperAdmin.value && props.superEditMode)
  ) {
    message("审批结束后仅允许新增附件，不允许删除", { type: "warning" });
    return;
  }
  attachmentItems.value.splice(index, 1);
  await persistAttachments();
};

const formCardRef = ref<HTMLElement | null>(null);
let autoEditApplied = false;

watch(
  () => props.detail,
  d => {
    if (!d) return;
    form.value = {
      contract_id: d.contract_id,
      project_id: d.project_id,
      expected_payment_date: d.expected_payment_date,
      category: d.category,
      payee_id: d.payee_id,
      amount: d.amount,
      content: d.content,
      payment_method: d.payment_method,
      remark: d.remark ?? ""
    };
    attachmentItems.value = parseAttachments(d.attachments_json);
    // ?edit=1 深链：加载后自动定位到可编辑的申请信息表单
    // （业务字段可编辑性仍由 canEditFields 决定，此处不改变编辑权限）
    if (!autoEditApplied && props.autoEdit && props.canEditFields) {
      autoEditApplied = true;
      nextTick(() => {
        formCardRef.value?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  },
  { immediate: true }
);
</script>

<template>
  <div ref="formCardRef" style="margin-bottom: 12px">
    <el-button
      type="primary"
      :loading="saving"
      :disabled="!canEditFields"
      @click="onSave"
      >保存</el-button
    >
    <el-button
      type="warning"
      :loading="submitApprovalLoading"
      :disabled="approvalFinishedLock || inApprovalFlow || submitApprovalLoading"
      @click="onSubmitApproval"
      >提交审批</el-button
    >
    <el-button
      type="success"
      :disabled="approvalFinishedLock || inApprovalFlow"
      @click="onRiskAssessment"
      >触发风险评估</el-button
    >
  </div>

  <el-form label-width="120px" style="max-width: 900px">
    <el-form-item label="关联合同">
      <el-select
        v-model="form.contract_id"
        filterable
        clearable
        style="width: 360px"
        disabled
        @change="onSelectContract"
      >
        <el-option
          v-for="item in contracts"
          :key="item.id"
          :value="item.id"
          :label="`${item.contract_no} | ${item.counterparty}`"
        />
      </el-select>
    </el-form-item>

    <el-form-item label="所属项目">
      <el-input
        :model-value="projectName || '-'"
        disabled
        style="width: 360px"
      />
    </el-form-item>

    <el-form-item label="剩余额度">
      <el-tag type="success">{{ remainingAmountDisplay }}</el-tag>
    </el-form-item>

    <el-form-item label="付款类别">
      <el-select
        v-model="form.category"
        clearable
        style="width: 220px"
        :disabled="!canEditFields"
      >
        <el-option label="特殊审批" value="特殊审批" />
        <el-option label="行政费" value="行政费" />
        <el-option label="劳务费" value="劳务费" />
        <el-option label="机械费" value="机械费" />
        <el-option label="材料费" value="材料费" />
        <el-option label="其他费用" value="其他费用" />
      </el-select>
    </el-form-item>

    <el-form-item label="收款人">
      <el-select
        v-model="form.payee_id"
        filterable
        clearable
        style="width: 360px"
        :disabled="!canEditFields"
      >
        <el-option
          v-for="item in payees"
          :key="item.id"
          :value="item.id"
          :label="`${item.name} (${item.bank_account})`"
        />
      </el-select>
    </el-form-item>

    <el-form-item label="申请金额">
      <div style="display: flex; align-items: center; gap: 12px">
        <el-input-number
          v-model="form.amount"
          :min="0"
          :precision="2"
          :step="1000"
          :disabled="!canEditFields"
        />
        <span style="font-weight: 700; color: #6b4f2a">{{
          amountDisplay
        }}</span>
      </div>
    </el-form-item>

    <el-form-item label="预计付款日">
      <el-date-picker
        v-model="form.expected_payment_date"
        type="date"
        value-format="YYYY-MM-DD"
        :disabled="!canEditFields"
      />
    </el-form-item>

    <el-form-item label="付款方式">
      <el-select
        v-model="form.payment_method"
        clearable
        style="width: 220px"
        :disabled="!canEditFields"
      >
        <el-option label="对公转账" value="对公转账" />
        <el-option label="现金" value="现金" />
        <el-option label="票据" value="票据" />
        <el-option label="其他" value="其他" />
      </el-select>
    </el-form-item>

    <el-form-item label="付款内容">
      <el-input
        v-model="form.content"
        type="textarea"
        :rows="3"
        :disabled="!canEditFields"
      />
    </el-form-item>

    <el-form-item label="备注">
      <el-input
        v-model="form.remark"
        type="textarea"
        :rows="2"
        :disabled="!canEditFields"
      />
    </el-form-item>
    <el-form-item label="我方付款主体">
      <el-input
        :model-value="selectedEntity ? selectedEntity.entity_name : '-'"
        disabled
        style="width: 360px"
      />
    </el-form-item>
    <el-form-item label="我方付款账号">
      <el-input
        :model-value="
          selectedEntityAccount
            ? `${selectedEntityAccount.bank_name} / ${selectedEntityAccount.account_no}`
            : '-'
        "
        disabled
        style="width: 520px"
      />
    </el-form-item>
    <el-form-item label="对方主体">
      <el-input
        :model-value="selectedPayee ? selectedPayee.name : '-'"
        disabled
        style="width: 360px"
      />
    </el-form-item>
    <el-form-item label="对方收款账号">
      <el-input
        :model-value="
          selectedPayee
            ? `${selectedPayee.bank_name} / ${selectedPayee.bank_account}`
            : '-'
        "
        disabled
        style="width: 520px"
      />
    </el-form-item>
    <el-form-item label="付款附件">
      <div style="width: 100%">
        <el-upload
          drag
          action="#"
          :show-file-list="false"
          :disabled="uploadingAttachment"
          :http-request="uploadAttachment"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
        >
          <div class="el-upload__text">
            拖拽文件到这里，或 <em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              审批结束后支持补传凭证附件；审批中及已结束默认不允许删除附件
            </div>
          </template>
        </el-upload>

        <el-table
          :data="attachmentItems"
          size="small"
          style="margin-top: 12px"
        >
          <el-table-column label="文件名" min-width="260">
            <template #default="scope">{{ scope.row.file_name }}</template>
          </el-table-column>
          <el-table-column label="大小" width="120">
            <template #default="scope">{{
              scope.row.file_size ?? "-"
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="220" fixed="right">
            <template #default="scope">
              <el-link
                type="primary"
                @click="
                  openAttachmentPreview(
                    scope.row.file_key,
                    scope.row.file_name || scope.row.file_key
                  )
                "
              >
                预览
              </el-link>
              <el-link
                :href="fileUrl(scope.row.file_key)"
                target="_blank"
                :download="scope.row.file_name || true"
                rel="noopener noreferrer"
                type="success"
                style="margin-left: 12px"
              >
                下载
              </el-link>
              <el-button
                link
                type="danger"
                style="margin-left: 12px"
                :disabled="inApprovalFlow"
                @click="removeAttachment(scope.$index)"
              >
                移除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-form-item>
  </el-form>

  <el-divider v-if="detail">申请摘要</el-divider>
  <el-descriptions v-if="detail" :column="2" border>
    <el-descriptions-item label="流水号">{{
      detail.serial_no
    }}</el-descriptions-item>
    <el-descriptions-item label="状态">{{
      toPaymentStatusLabel(detail.status)
    }}</el-descriptions-item>
    <el-descriptions-item label="付款类别">{{
      toPaymentCategoryLabel(detail.category)
    }}</el-descriptions-item>
    <el-descriptions-item label="付款方式">{{
      toPaymentMethodLabel(detail.payment_method)
    }}</el-descriptions-item>
    <el-descriptions-item label="所属项目">{{
      projectName || detail.project_id
    }}</el-descriptions-item>
    <el-descriptions-item label="我方主体">{{
      selectedEntity?.entity_name || "-"
    }}</el-descriptions-item>
    <el-descriptions-item label="我方账号" :span="2">{{
      detail.payment_account ||
      (selectedEntityAccount
        ? `${selectedEntityAccount.bank_name} / ${selectedEntityAccount.account_no}`
        : "-")
    }}</el-descriptions-item>
    <el-descriptions-item label="对方单位">{{
      selectedPayee?.name || detail.contract?.counterparty || "-"
    }}</el-descriptions-item>
    <el-descriptions-item label="对方账号">{{
      selectedPayee
        ? `${selectedPayee.bank_name} / ${selectedPayee.bank_account}`
        : "-"
    }}</el-descriptions-item>
    <el-descriptions-item label="申请金额" :span="2">{{
      amountDisplay
    }}</el-descriptions-item>
    <el-descriptions-item label="支付时间">
      {{ formatBeijingDateTime(detail.paid_at) }}
    </el-descriptions-item>
    <el-descriptions-item label="支付流水号">
      {{ detail.payment_reference || "-" }}
    </el-descriptions-item>
    <el-descriptions-item label="付款账户" :span="2">
      {{ detail.payment_account || "-" }}
    </el-descriptions-item>
  </el-descriptions>

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

  <el-dialog v-model="approvalDialogVisible" title="审批提交设置" width="560px">
    <el-alert
      type="info"
      :closable="false"
      title="用于临时指定审批人或补充审批说明；不填写时按模板默认流程执行"
      style="margin-bottom: 12px"
    />
    <el-form label-width="120px">
      <el-form-item label="审批摘要">
        <el-input
          v-model="approvalSummary"
          placeholder="可选：补充本次提交重点，例如 付款节点加急"
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
          placeholder='例如 {"default_assignee_userids":["zhangsan"],"note":"付款凭证已补传"}'
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="approvalDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitApprovalLoading"
        :disabled="submitApprovalLoading"
        @click="confirmSubmitApproval"
        >确认提交</el-button
      >
    </template>
  </el-dialog>
</template>
