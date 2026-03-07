<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import {
  createPaymentRequest,
  getPaymentRequest,
  getRiskReport,
  markPaymentPaid,
  submitPaymentApproval,
  triggerRiskAssessment,
  updatePaymentRequest,
  listPayees,
  type Payee,
  type PaymentRequestDetail
} from "@/api/payment";
import { getApprovalDetail, type ApprovalDetailResponse } from "@/api/approval";
import {
  listContracts,
  type Contract,
  type InstanceConfig
} from "@/api/contract";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { listProjects, type Project } from "@/api/project";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import {
  isApprovalFinishedLocked,
  isApprovalInProgress
} from "../shared/approvalLock";

defineOptions({ name: "PaymentDetail" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const loading = ref(false);
const saving = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const isCreate = computed(() => route.params.id === "create");
const requestId = computed(() => Number(route.params.id));
const inWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));
const paymentDetailBasePath = computed(() =>
  inWorkspaceRoute.value
    ? "/workspace/payment/detail"
    : "/finance/payment/detail"
);
const paymentListPath = computed(() =>
  inWorkspaceRoute.value ? "/workspace/payment/wizard" : "/finance/payment"
);
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
const canEditFields = computed(
  () =>
    isCreate.value ||
    (!inApprovalFlow.value && !approvalFinishedLock.value) ||
    (isSuperAdmin.value && superEditMode.value)
);

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const projects = ref<Project[]>([]);
const entities = ref<Entity[]>([]);
const entityBankAccountMap = ref<Record<number, EntityBankAccount[]>>({});
const detail = ref<PaymentRequestDetail | null>(null);

type PaymentAttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};
const attachmentItems = ref<PaymentAttachmentDraft[]>([]);
const uploadingAttachment = ref(false);

const approvalDetail = ref<ApprovalDetailResponse | null>(null);

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

const selectedContract = computed(() => {
  return (
    contracts.value.find(item => item.id === form.value.contract_id) ?? null
  );
});
const selectedPayee = computed(() => {
  return payees.value.find(item => item.id === form.value.payee_id) ?? null;
});
const projectName = computed(() => {
  const target = projects.value.find(item => item.id === form.value.project_id);
  return target ? `${target.project_name} (${target.project_code})` : "";
});
const selectedEntity = computed(() => {
  const entityId = selectedContract.value?.entity_id;
  if (!entityId) return null;
  return entities.value.find(item => item.id === entityId) ?? null;
});
const selectedEntityAccount = computed(() => {
  const entityId = selectedContract.value?.entity_id;
  if (!entityId) return null;
  const accounts = entityBankAccountMap.value[entityId] ?? [];
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

const riskStatus = ref("none");
const riskReport = ref<Record<string, unknown> | null>(null);
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

const toRiskLevelLabel = (level: unknown) => {
  if (typeof level !== "string" || !level) return "-";
  return riskLevelLabelMap[level] ?? level;
};

const toRiskLevelTagType = (level: unknown): TagType => {
  if (typeof level !== "string" || !level) return "info";
  return riskLevelTagTypeMap[level] ?? "info";
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
  `/api/v1/upload/object/${encodeURIComponent(fileKey)}`;

const roundNodes = computed(() => {
  if (!approvalDetail.value) return [];
  return approvalDetail.value.nodes
    .filter(item => item.round === approvalDetail.value?.instance.current_round)
    .sort((a, b) => a.sort_order - b.sort_order);
});

const getNodeTasks = (nodeId: number) => {
  if (!approvalDetail.value) return [];
  return approvalDetail.value.tasks.filter(
    item => item.node_instance_id === nodeId
  );
};

const aiGateReviews = computed(
  () => approvalDetail.value?.ai_gate_reviews ?? []
);

const toActionLabel = (action: string | null) => {
  if (!action) return "待处理";
  if (action === "approve") return "通过";
  if (action === "reject") return "驳回";
  if (action === "return_initiator") return "退回发起人";
  if (action === "return_prev") return "退回上一步";
  if (action === "return_to") return "退回指定节点";
  if (action === "transfer") return "转办";
  return action;
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
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const applyApprovalNoteTemplate = (value: string) => {
  if (!value) return;
  approvalFormConfig.value.note = value;
};

const paidDialogVisible = ref(false);
const paidSubmitting = ref(false);
const paidForm = ref({
  paid_at: "",
  payment_reference: "",
  payment_account: "",
  remark: ""
});

const loadRefs = async () => {
  const [contractRes, payeeRes, projectRes, entityRes] = await Promise.all([
    listContracts({ page: 1, pageSize: 400, direction: "outbound" }),
    listPayees(),
    listProjects({ page: 1, pageSize: 400 }),
    listEntities()
  ]);
  contracts.value = contractRes.data;
  payees.value = payeeRes.data;
  projects.value = projectRes.data;
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

const onSelectContract = (contractId?: number) => {
  const selected = contracts.value.find(item => item.id === contractId);
  if (!selected) return;
  form.value.project_id = selected.project_id;
};

const loadApprovalDetail = async (approvalInstanceId: number | null) => {
  if (!approvalInstanceId) {
    approvalDetail.value = null;
    return;
  }
  try {
    const result = await getApprovalDetail(approvalInstanceId);
    approvalDetail.value = result.data;
  } catch {
    approvalDetail.value = null;
  }
};

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getPaymentRequest(requestId.value);
    detail.value = result.data;
    form.value = {
      contract_id: result.data.contract_id,
      project_id: result.data.project_id,
      expected_payment_date: result.data.expected_payment_date,
      category: result.data.category,
      payee_id: result.data.payee_id,
      amount: result.data.amount,
      content: result.data.content,
      payment_method: result.data.payment_method,
      remark: result.data.remark ?? ""
    };
    superEditMode.value = false;
    superEditNote.value = "";
    attachmentItems.value = parseAttachments(result.data.attachments_json);
    const rr = await getRiskReport(requestId.value);
    riskStatus.value = rr.data.status;
    riskReport.value = rr.data.result;
    await loadApprovalDetail(result.data.approval_instance_id);
  } finally {
    loading.value = false;
  }
};

const onSave = async () => {
  if (!canEditFields.value) {
    message("审批结束后仅允许补充附件；如需修改请联系超管开启编辑模式", {
      type: "warning"
    });
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
  if (form.value.amount > remainingAmount.value && isCreate.value) {
    message("申请金额超过合同剩余额度", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    if (isCreate.value) {
      const result = await createPaymentRequest({
        contract_id: form.value.contract_id,
        project_id: form.value.project_id,
        expected_payment_date: form.value.expected_payment_date,
        category: form.value.category,
        payee_id: form.value.payee_id,
        amount: form.value.amount,
        content: form.value.content,
        payment_method: form.value.payment_method,
        attachments_json: serializeAttachments(),
        remark: form.value.remark
      });
      message(`创建成功，金额大写：${result.data.amount_cn}`, {
        type: "success"
      });
      router.replace(`${paymentDetailBasePath.value}/${result.data.id}`);
      return;
    }

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
        isSuperAdmin.value && superEditMode.value ? true : undefined,
      edit_note:
        isSuperAdmin.value && superEditMode.value
          ? superEditNote.value.trim() || undefined
          : undefined
    });
    message("保存成功", { type: "success" });
    await loadDetail();
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const onSubmitApproval = async () => {
  if (isCreate.value) {
    message("请先保存申请", { type: "warning" });
    return;
  }
  approvalSummary.value = detail.value?.serial_no
    ? `${detail.value.serial_no} | ${detail.value.content} | ${detail.value.amount}`
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
  if (isCreate.value) return;

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

  await submitPaymentApproval(requestId.value, {
    biz_summary: approvalSummary.value.trim() || undefined,
    instance_config: instanceConfig
  });
  approvalDialogVisible.value = false;
  message("已提交审批", { type: "success" });
  await loadDetail();
};

const onRiskAssessment = async () => {
  if (isCreate.value) {
    message("请先保存申请", { type: "warning" });
    return;
  }
  await triggerRiskAssessment(requestId.value);
  message("已触发风险评估", { type: "success" });
  await loadDetail();
};

const persistAttachments = async () => {
  if (isCreate.value) return;
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
    !(isSuperAdmin.value && superEditMode.value)
  ) {
    message("审批结束后仅允许新增附件，不允许删除", { type: "warning" });
    return;
  }
  attachmentItems.value.splice(index, 1);
  await persistAttachments();
};

const onMarkPaid = async () => {
  if (isCreate.value) return;
  paidForm.value = {
    paid_at: new Date().toISOString().slice(0, 10),
    payment_reference: "",
    payment_account:
      detail.value?.payment_account ??
      (selectedEntityAccount.value
        ? `${selectedEntityAccount.value.bank_name} / ${selectedEntityAccount.value.account_no}`
        : ""),
    remark: ""
  };
  paidDialogVisible.value = true;
};

const confirmMarkPaid = async () => {
  if (isCreate.value) return;
  paidSubmitting.value = true;
  try {
    await markPaymentPaid(requestId.value, {
      paid_at: paidForm.value.paid_at || undefined,
      payment_reference: paidForm.value.payment_reference || undefined,
      payment_account: paidForm.value.payment_account || undefined,
      remark: paidForm.value.remark || undefined
    });
    paidDialogVisible.value = false;
    message("已标记为已付款", { type: "success" });
    await loadDetail();
  } finally {
    paidSubmitting.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadRefs(), loadWecomUsers()]);
  await loadDetail();
});
</script>

<template>
  <el-card shadow="never" :loading="loading" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>{{
          isCreate ? "新建付款申请" : `付款详情 - ${detail?.serial_no || ""}`
        }}</span>
        <div>
          <el-button @click="router.push(paymentListPath)">返回</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!canEditFields"
            @click="onSave"
            >保存</el-button
          >
          <el-button
            type="warning"
            :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
            @click="onSubmitApproval"
            >提交审批</el-button
          >
          <el-button
            type="success"
            :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
            @click="onRiskAssessment"
            >触发风险评估</el-button
          >
          <el-button
            type="primary"
            plain
            :disabled="isCreate || detail?.status !== 'approved'"
            @click="onMarkPaid"
          >
            标记付款
          </el-button>
        </div>
      </div>
    </template>

    <el-alert
      v-if="inApprovalFlow"
      title="当前付款申请处于审批中：业务字段锁定，但允许继续上传付款凭证附件"
      type="warning"
      :closable="false"
      style="margin-bottom: 12px"
    />

    <el-alert
      v-if="approvalFinishedLock"
      title="审批流程已结束：仅允许补充附件，业务字段默认锁定"
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

    <el-form label-width="120px" style="max-width: 900px">
      <el-form-item label="关联合同">
        <el-select
          v-model="form.contract_id"
          filterable
          clearable
          style="width: 360px"
          :disabled="!isCreate || !canEditFields"
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
                  :href="fileUrl(scope.row.file_key)"
                  target="_blank"
                  type="primary"
                >
                  查看
                </el-link>
                <el-link
                  :href="fileUrl(scope.row.file_key)"
                  target="_blank"
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
        detail.status
      }}</el-descriptions-item>
      <el-descriptions-item label="所属项目">{{
        projectName || detail.project_id
      }}</el-descriptions-item>
      <el-descriptions-item label="我方主体">{{
        selectedEntity?.entity_name || "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="我方账号" :span="2">{{
        selectedEntityAccount
          ? `${selectedEntityAccount.bank_name} / ${selectedEntityAccount.account_no}`
          : "-"
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
        {{ detail.paid_at || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="支付流水号">
        {{ detail.payment_reference || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="付款账户" :span="2">
        {{ detail.payment_account || "-" }}
      </el-descriptions-item>
    </el-descriptions>

    <el-divider v-if="detail">AI风险评估</el-divider>
    <div v-if="detail" style="margin-bottom: 8px">
      <el-tag :type="riskTagType[riskStatus] || 'info'">{{
        riskStatus
      }}</el-tag>
    </div>
    <el-descriptions v-if="riskReport" :column="2" border>
      <el-descriptions-item label="风险等级">
        <el-tag :type="toRiskLevelTagType(riskReport.overall_risk)">
          {{ toRiskLevelLabel(riskReport.overall_risk) }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="风险分数">{{
        riskReport.score ?? "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="总结" :span="2">{{
        riskReport.summary || "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="建议" :span="2">
        {{
          Array.isArray(riskReport.recommendations)
            ? riskReport.recommendations.join("；")
            : "-"
        }}
      </el-descriptions-item>
    </el-descriptions>

    <el-divider v-if="approvalDetail">审批信息</el-divider>
    <el-descriptions v-if="approvalDetail" :column="2" border>
      <el-descriptions-item label="审批单号">
        {{ approvalDetail.instance.instance_no }}
      </el-descriptions-item>
      <el-descriptions-item label="审批状态">
        {{ approvalDetail.instance.status }}
      </el-descriptions-item>
      <el-descriptions-item label="当前节点">
        {{ approvalDetail.instance.current_node_key || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="发起人">
        {{ approvalDetail.instance.initiator_userid }}
      </el-descriptions-item>
    </el-descriptions>

    <el-table
      v-if="approvalDetail"
      :data="roundNodes"
      size="small"
      style="margin-top: 12px"
    >
      <el-table-column prop="node_name" label="节点" min-width="140" />
      <el-table-column prop="node_type" label="类型" width="120" />
      <el-table-column prop="status" label="状态" width="110" />
      <el-table-column label="审批意见" min-width="260">
        <template #default="scope">
          <template v-if="getNodeTasks(scope.row.id).length">
            <div
              v-for="task in getNodeTasks(scope.row.id)"
              :key="task.id"
              style="margin-bottom: 4px"
            >
              {{ task.assignee_userid }}：{{ toActionLabel(task.action) }}
              <span v-if="task.comment">（{{ task.comment }}）</span>
            </div>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <el-divider v-if="aiGateReviews.length > 0">AI审核意见</el-divider>
    <el-table
      v-if="aiGateReviews.length > 0"
      :data="aiGateReviews"
      size="small"
    >
      <el-table-column prop="node_key" label="节点" width="160" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="outcome" label="结论" width="100" />
      <el-table-column label="总结/意见" min-width="260">
        <template #default="scope">{{
          scope.row.summary || scope.row.comment || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="建议" min-width="260">
        <template #default="scope">
          {{
            Array.isArray(scope.row.recommendations) &&
            scope.row.recommendations.length > 0
              ? scope.row.recommendations.join("；")
              : "-"
          }}
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="approvalDialogVisible"
      title="审批提交设置"
      width="560px"
    >
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
        <el-button type="primary" @click="confirmSubmitApproval"
          >确认提交</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="paidDialogVisible"
      title="登记付款执行信息"
      width="560px"
    >
      <el-form label-width="120px">
        <el-form-item label="支付日期">
          <el-date-picker
            v-model="paidForm.paid_at"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="支付流水号">
          <el-input
            v-model="paidForm.payment_reference"
            placeholder="例如网银流水号"
          />
        </el-form-item>
        <el-form-item label="付款账户">
          <el-input
            v-model="paidForm.payment_account"
            placeholder="例如 建行-XX支行-1234"
          />
        </el-form-item>
        <el-form-item label="付款备注">
          <el-input v-model="paidForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="paidDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="paidSubmitting"
          @click="confirmMarkPaid"
          >确认标记</el-button
        >
      </template>
    </el-dialog>
  </el-card>
</template>
