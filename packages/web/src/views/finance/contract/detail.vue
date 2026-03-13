<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
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
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { isApprovalFinishedLocked, isApprovalInProgress } from "../shared/approvalLock";

defineOptions({ name: "ContractDetail" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);

const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const userStore = useUserStoreHook();
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

const toAiStatusLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return aiStatusLabelMap[value] ?? value;
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

const isCreate = computed(() => route.params.id === "create");
const contractId = computed(() => Number(route.params.id));
const inApprovalFlow = computed(
  () => isApprovalInProgress(detail.value?.status)
);
const approvalFinishedLock = computed(
  () =>
    isApprovalFinishedLocked({
      isCreate: isCreate.value,
      approvalInstanceId: detail.value?.approval_instance_id,
      bizStatus: detail.value?.status
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

const amountInput = computed({
  get: () =>
    Number.isFinite(form.value.total_amount) ? String(form.value.total_amount) : "",
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

const amountUppercase = computed(() => toChineseAmount(form.value.total_amount));
const amountDisplay = computed(() => {
  const value = Number(form.value.total_amount || 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${amountUppercase.value}）`;
});
const selectedEntity = computed(() =>
  entities.value.find(item => item.id === form.value.entity_id) ?? null
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

const parseAttachments = (raw: string | null | undefined): ContractAttachmentDraft[] => {
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
    return items.filter((item): item is ContractAttachmentDraft => item !== null);
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
const isSuperAdmin = computed(() => (userStore.roles ?? []).includes("super_admin"));

const applyApprovalNoteTemplate = (value: string) => {
  if (!value) return;
  approvalFormConfig.value.note = value;
};

const loadBaseData = async () => {
  const [entityRes] = await Promise.all([listEntities(), loadProjects(), loadWecomUsers()]);
  entities.value = entityRes.data;
  const entries = await Promise.all(
    entityRes.data.map(async item => {
      const accountRes = await listEntityBankAccounts(item.id).catch(() => ({ data: [] }));
      return [item.id, accountRes.data] as const;
    })
  );
  entityBankAccountMap.value = Object.fromEntries(entries);
};

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getContract(contractId.value);
    detail.value = result.data;
    form.value = {
      direction: result.data.direction,
      project_id: result.data.project_id,
      entity_id: result.data.entity_id,
      counterparty: result.data.counterparty,
      contract_type: result.data.contract_type,
      handler_userid: result.data.handler_userid,
      contract_date: result.data.contract_date,
      total_amount: result.data.total_amount,
      remark: result.data.remark ?? ""
    };
    superEditMode.value = false;
    superEditNote.value = "";
    attachmentItems.value = parseAttachments(result.data.attachments_json);
    await loadAiReview();
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

const onSave = async () => {
  if (!canEdit.value) {
    message("审批结束后仅允许补充附件；如需修改请联系超管开启编辑模式", { type: "warning" });
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

  if (isSuperAdmin.value && superEditMode.value && !superEditNote.value.trim()) {
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
      router.replace(`/finance/contract/detail/${result.data.id}`);
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
      admin_edit_mode: isSuperAdmin.value && superEditMode.value ? true : undefined,
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
    const pickedUserIds = approvalFormConfig.value.default_assignee_userids.filter(Boolean);
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

  await submitContractApproval(contractId.value, {
    biz_summary: approvalSummary.value.trim() || undefined,
    instance_config: instanceConfig
  });
  approvalDialogVisible.value = false;
  message("已提交审批", { type: "success" });
  await loadDetail();
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

    if (!isCreate.value && !canEdit.value) {
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

const removeAttachment = (index: number) => {
  if (!canEdit.value) return;
  attachmentItems.value.splice(index, 1);
};

const onSubmitAmountChange = async (row: ContractAmountChange) => {
  if (isCreate.value) return;
  await submitAmountChangeApproval(contractId.value, row.id);
  message("金额变更已提交审批", { type: "success" });
  await loadDetail();
};

const goBack = () => {
  router.push("/finance/contract");
};

onMounted(async () => {
  if (isCreate.value && typeof route.query.direction === "string") {
    if (
      route.query.direction === "inbound" ||
      route.query.direction === "outbound"
    ) {
      form.value.direction = route.query.direction;
    }
  }
  await loadBaseData();
  await loadDetail();
});
</script>

<template>
  <el-card v-loading="loading" shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>{{
          isCreate ? "新建合同" : `合同详情 - ${detail?.contract_no || ""}`
        }}</span>
        <div>
          <el-button @click="goBack">返回</el-button>
          <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="onSave"
            >保存</el-button
          >
          <el-button
            type="warning"
            :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
            @click="onSubmitApproval"
          >
            提交审批
          </el-button>
          <el-button
            type="success"
            :disabled="isCreate || approvalFinishedLock || inApprovalFlow"
            @click="onTriggerAiReview"
          >
            触发AI审查
          </el-button>
        </div>
      </div>
    </template>

    <el-form label-width="110px" style="max-width: 900px">
      <el-form-item label="合同方向">
        <el-radio-group v-model="form.direction" :disabled="!isCreate && !canEdit">
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
          <div v-if="selectedEntity" style="margin-top: 6px; color: #6e6458; font-size: 13px">
            {{ selectedEntity.entity_name }}
            <span v-if="selectedEntityAccount">
              | {{ selectedEntityAccount.bank_name }} / {{ selectedEntityAccount.account_no }}
            </span>
          </div>
        </div>
      </el-form-item>
      <el-form-item label="对方单位">
        <el-input v-model="form.counterparty" :disabled="!canEdit" placeholder="请输入对方单位" />
      </el-form-item>
      <el-form-item label="合同类型">
        <el-select v-model="form.contract_type" clearable style="width: 220px" :disabled="!canEdit">
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
        <div style="display: flex; align-items: center; gap: 12px; width: 100%">
          <el-input
            v-model="amountInput"
            type="number"
            placeholder="请输入金额"
            style="max-width: 260px"
            :disabled="!canEdit"
          />
          <span style="font-weight: 700; color: #6b4f2a">{{ amountDisplay }}</span>
        </div>
      </el-form-item>
      <el-form-item label="合同附件">
        <div style="width: 100%">
          <el-upload
            drag
            action="#"
            :show-file-list="false"
            :disabled="uploadingAttachment || inApprovalFlow"
            :http-request="uploadAttachment"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
          >
            <div class="el-upload__text">拖拽文件到这里，或 <em>点击上传</em></div>
            <template #tip>
              <div class="el-upload__tip">支持常见文档和图片，上传后可预览/下载</div>
            </template>
          </el-upload>

          <el-table :data="attachmentItems" size="small" style="margin-top: 12px">
            <el-table-column label="文件名" min-width="260">
              <template #default="scope">{{ scope.row.file_name }}</template>
            </el-table-column>
            <el-table-column label="大小" width="120">
              <template #default="scope">{{ scope.row.file_size ?? "-" }}</template>
            </el-table-column>
            <el-table-column label="操作" width="220" fixed="right">
              <template #default="scope">
                <el-link :href="fileUrl(scope.row.file_key)" target="_blank" type="primary">
                  预览
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
                  :disabled="!canEdit"
                  @click="removeAttachment(scope.$index)"
                >
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="3" :disabled="!canEdit" />
      </el-form-item>
    </el-form>

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

    <el-form v-if="isSuperAdmin && !isCreate" inline style="margin-bottom: 10px">
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

    <el-divider v-if="detail">财务摘要</el-divider>
    <el-row v-if="detail" :gutter="12" style="margin-bottom: 8px">
      <el-col :span="6"
        ><el-statistic title="合同总额" :value="detail.total_amount"
      /></el-col>
      <el-col :span="6"
        ><el-statistic title="已付金额" :value="detail.paid_amount"
      /></el-col>
      <el-col :span="6"
        ><el-statistic title="剩余额度" :value="remainingAmount"
      /></el-col>
      <el-col :span="6">
        <div style="margin-top: 8px">
          AI审查状态
          <el-tag
            :type="aiStatusTagType[aiStatus] || 'info'"
            style="margin-left: 8px"
          >
            {{ toAiStatusLabel(aiStatus) }}
          </el-tag>
        </div>
      </el-col>
    </el-row>

    <el-divider v-if="aiReviewData">AI审查报告</el-divider>
    <el-descriptions v-if="aiReviewData" :column="2" border>
      <el-descriptions-item label="风险等级">
        <el-tag :type="toRiskLevelTagType(aiReviewData.overall_risk)">
          {{ toRiskLevelLabel(aiReviewData.overall_risk) }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="风险分数">
        {{ aiReviewData.score ?? "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="总结" :span="2">
        {{ aiReviewData.summary || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="建议" :span="2">
        {{
          Array.isArray(aiReviewData.recommendations)
            ? aiReviewData.recommendations.join("；")
            : "-"
        }}
      </el-descriptions-item>
    </el-descriptions>

    <el-divider v-if="detail">金额变更记录</el-divider>
    <el-table v-if="detail" :data="detail.amount_changes" size="small">
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column prop="change_type" label="类型" width="100" />
      <el-table-column prop="old_amount" label="原金额" width="120" />
      <el-table-column prop="new_amount" label="新金额" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="scope">{{ toBizStatusLabel(scope.row.status) }}</template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="220" />
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

    <el-dialog
      v-model="approvalDialogVisible"
      title="审批提交设置"
      width="560px"
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
        <el-form-item label="设置模式" v-if="isSuperAdmin">
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
        <el-form-item label="实例配置(JSON)" v-else-if="isSuperAdmin">
          <el-input
            v-model="approvalConfigText"
            type="textarea"
            :rows="7"
            placeholder='例如 {"default_assignee_userids":["zhangsan"],"note":"加急审批"}'
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

    <el-divider v-if="detail">关联付款申请</el-divider>
    <el-table v-if="detail" :data="detail.payment_requests" size="small">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="serial_no" label="流水号" width="160" />
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column label="状态" width="120">
        <template #default="scope">{{ toBizStatusLabel(scope.row.status) }}</template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
    </el-table>
  </el-card>
</template>
