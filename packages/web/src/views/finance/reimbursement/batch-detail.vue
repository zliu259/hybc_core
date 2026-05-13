<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  aiAuditStatusLabel,
  precheckStatusLabel,
  statusLabel
} from "@/utils/enum-labels";
import {
  getBatchAuditReport,
  getReimbursementBatch,
  submitBatchApproval,
  triggerBatchAudit,
  updateBatchItemBasicInfo,
  updateBatchPaymentVouchers,
  updateBatchPayoutPlan,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";
import { useUserStoreHook } from "@/store/modules/user";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { listPayees, type Payee } from "@/api/payment";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { formatToken, getToken } from "@/utils/auth";
import { formatBeijingDateTime } from "@/utils/datetime";
import ReimbursementDetail from "./detail.vue";

defineOptions({ name: "ReimbursementBatchDetail" });

const props = defineProps<{
  batchId?: number | string;
  drawerMode?: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "changed"): void;
}>();

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const effectiveBatchId = computed(() => props.batchId ?? route.params.id);
const batchId = computed(() => Number(effectiveBatchId.value));
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);
const canMaintainBatchDetail = computed(() =>
  (userStore.roles ?? []).some(role =>
    ["super_admin", "manager", "finance"].includes(role)
  )
);

const loading = ref(false);
const actionLoading = ref(false);
const savingPayout = ref(false);
const savingVouchers = ref(false);
const uploadingVoucher = ref(false);
const detail = ref<ReimbursementBatchDetail | null>(null);
const auditResult = ref<Record<string, unknown> | string | null>(null);
const auditStatus = ref("none");
const projects = ref<Project[]>([]);
const entities = ref<Entity[]>([]);
const bankAccounts = ref<EntityBankAccount[]>([]);
const internalPayees = ref<Payee[]>([]);

const payoutEdit = ref({
  payment_method: "",
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined,
  payment_account: "",
  payee_id: undefined as number | undefined
});

const voucherEditorRows = ref<
  Array<{
    file_key: string;
    file_name: string;
    file_size?: number;
    is_new: boolean;
  }>
>([]);

const editItemDialogVisible = ref(false);
const savingItemBasic = ref(false);
const envelopeDetailDrawerVisible = ref(false);
const activeEnvelopeDetailId = ref<number | null>(null);
const editItemForm = ref({
  envelope_id: 0,
  invoice_no: "",
  expense_date: "",
  amount: 0,
  category: "",
  description: ""
});

const paymentMethodOptions = [
  { label: "可后续补充", value: "" },
  { label: "对公转账", value: "transfer" },
  { label: "转账", value: "personal_transfer" },
  { label: "现金", value: "cash" },
  { label: "票据", value: "bill" },
  { label: "其他", value: "other" }
];

const paymentMethodLabelMap: Record<string, string> = {
  transfer: "对公转账",
  bank_transfer: "对公转账",
  对公转账: "对公转账",
  personal_transfer: "转账",
  转账: "转账",
  cash: "现金",
  现金: "现金",
  bill: "票据",
  票据: "票据",
  other: "其他",
  其他: "其他"
};

const invoiceRiskTagMap: Record<
  string,
  "success" | "warning" | "danger" | "info"
> = {
  low: "success",
  medium: "warning",
  high: "danger"
};

const projectNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of projects.value) {
    map.set(item.id, item.project_name);
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

const entityNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of entities.value) {
    map.set(item.id, item.entity_name);
  }
  return map;
});

const activeEntities = computed(() =>
  entities.value.filter(item => item.status === "active")
);

const activeBankAccounts = computed(() =>
  bankAccounts.value.filter(item => item.status === "active")
);

const fileUrl = (fileKey: string) =>
  resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);

const toProjectLabel = (projectId: number | null | undefined) => {
  if (typeof projectId !== "number") return "-";
  return projectNameMap.value.get(projectId) ?? String(projectId);
};

const toUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const toEntityLabel = (entityId: number | null | undefined) => {
  if (typeof entityId !== "number") return "-";
  return entityNameMap.value.get(entityId) ?? String(entityId);
};

const toPaymentMethodLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentMethodLabelMap[value] ?? value;
};

const toInvoiceRiskLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return value;
};

const normalizePaymentMethodValue = (value: string | null | undefined) => {
  if (!value) return "";
  if (value === "transfer" || value === "bank_transfer" || value === "对公转账")
    return "transfer";
  if (value === "personal_transfer" || value === "转账")
    return "personal_transfer";
  if (value === "cash" || value === "现金") return "cash";
  if (value === "bill" || value === "票据") return "bill";
  if (value === "other" || value === "其他") return "other";
  return "";
};

const toAccountLabel = (item: EntityBankAccount) => {
  const branch = item.bank_branch_no?.trim();
  return `${item.bank_name}${branch ? `-${branch}` : ""} / ${item.account_no}`;
};

const parsePaymentVouchers = (
  paymentVouchers: ReimbursementBatchDetail["payment_vouchers"],
  paymentVouchersJson: string | null | undefined
) => {
  if (Array.isArray(paymentVouchers)) {
    return paymentVouchers.filter(item =>
      Boolean(item && typeof item.file_key === "string" && item.file_key.trim())
    );
  }
  if (!paymentVouchersJson) return [];
  try {
    const parsed = JSON.parse(paymentVouchersJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows = parsed
      .map(item => {
        if (!item || typeof item !== "object") return null;
        const row = item as {
          file_key?: string;
          file_name?: string;
          file_size?: number;
        };
        if (!row.file_key || !row.file_key.trim()) return null;
        return {
          file_key: row.file_key.trim(),
          file_name: row.file_name,
          file_size: row.file_size
        };
      })
      .filter(item => item !== null);
    return rows as Array<{
      file_key: string;
      file_name?: string;
      file_size?: number;
    }>;
  } catch {
    return [];
  }
};

const voucherRows = computed(() =>
  parsePaymentVouchers(
    detail.value?.payment_vouchers,
    detail.value?.payment_vouchers_json
  )
);

const syncVoucherEditorFromDetail = () => {
  voucherEditorRows.value = voucherRows.value.map(item => ({
    file_key: item.file_key,
    file_name: item.file_name || item.file_key,
    file_size: item.file_size,
    is_new: false
  }));
};

const uploadVoucher = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingVoucher.value = true;
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
    voucherEditorRows.value.unshift({
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size,
      is_new: true
    });
    message("支付凭证上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("支付凭证上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingVoucher.value = false;
  }
};

const removeVoucherRow = (index: number) => {
  voucherEditorRows.value.splice(index, 1);
};

const notifyChanged = () => {
  emit("changed");
};

const closeBatchDetail = () => {
  if (props.drawerMode) {
    emit("close");
    return;
  }
  router.push("/finance/reimbursement/batch");
};

const savePaymentVouchers = async () => {
  if (!detail.value) return;
  savingVouchers.value = true;
  try {
    await updateBatchPaymentVouchers(detail.value.id, {
      payment_vouchers: voucherEditorRows.value.map(item => ({
        file_key: item.file_key,
        file_name: item.file_name,
        file_size: item.file_size
      }))
    });
    message("支付凭证已保存", { type: "success" });
    await loadDetail();
    notifyChanged();
  } finally {
    savingVouchers.value = false;
  }
};

const openEditItemDialog = (
  item: ReimbursementBatchDetail["items"][number]
) => {
  editItemForm.value = {
    envelope_id: item.id,
    invoice_no: item.invoice_no ?? "",
    expense_date: item.expense_date ?? "",
    amount: Number(item.amount || 0),
    category: item.category ?? "",
    description: item.description ?? ""
  };
  editItemDialogVisible.value = true;
};

const openEnvelopeDetail = (id: number) => {
  activeEnvelopeDetailId.value = id;
  envelopeDetailDrawerVisible.value = true;
};

const closeEnvelopeDetail = () => {
  envelopeDetailDrawerVisible.value = false;
};

const onEnvelopeDetailClosed = () => {
  activeEnvelopeDetailId.value = null;
};

const onEnvelopeDetailChanged = async () => {
  await loadDetail();
};

const saveItemBasicInfo = async () => {
  if (!detail.value || !editItemForm.value.envelope_id) return;
  savingItemBasic.value = true;
  try {
    await updateBatchItemBasicInfo(
      detail.value.id,
      editItemForm.value.envelope_id,
      {
        invoice_no: editItemForm.value.invoice_no || undefined,
        expense_date: editItemForm.value.expense_date || undefined,
        amount: Number(editItemForm.value.amount),
        category: editItemForm.value.category || undefined,
        description: editItemForm.value.description || undefined
      }
    );
    message("报销基础信息已更新", { type: "success" });
    editItemDialogVisible.value = false;
    await loadDetail();
    notifyChanged();
  } finally {
    savingItemBasic.value = false;
  }
};

const loadBankAccounts = async (
  entityId: number | undefined,
  preferredAccountId?: number
) => {
  if (!entityId) {
    bankAccounts.value = [];
    payoutEdit.value.payment_entity_bank_account_id = undefined;
    return;
  }
  const result = await listEntityBankAccounts(entityId);
  bankAccounts.value = result.data;
  if (preferredAccountId) {
    payoutEdit.value.payment_entity_bank_account_id = preferredAccountId;
  }
};

const loadInternalPayees = async (
  applicantUserid: string | undefined,
  preferredPayeeId?: number | null
) => {
  if (!applicantUserid) {
    internalPayees.value = [];
    payoutEdit.value.payee_id = undefined;
    return;
  }
  const result = await listPayees({
    type: "internal",
    linked_userid: applicantUserid
  });
  internalPayees.value = result.data;
  if (preferredPayeeId) {
    payoutEdit.value.payee_id = preferredPayeeId;
  }
};

const syncEditFormFromDetail = async () => {
  if (!detail.value) return;
  payoutEdit.value.payment_method = normalizePaymentMethodValue(
    detail.value.payment_method
  );
  payoutEdit.value.payment_entity_id =
    detail.value.payment_entity_id ?? undefined;
  payoutEdit.value.payment_entity_bank_account_id =
    detail.value.payment_entity_bank_account_id ?? undefined;
  payoutEdit.value.payment_account = detail.value.payment_account ?? "";
  payoutEdit.value.payee_id = detail.value.payee_id ?? undefined;

  await Promise.all([
    loadBankAccounts(
      payoutEdit.value.payment_entity_id,
      payoutEdit.value.payment_entity_bank_account_id
    ),
    loadInternalPayees(detail.value.applicant_userid, detail.value.payee_id)
  ]);
};

const onEditEntityChange = async () => {
  payoutEdit.value.payment_entity_bank_account_id = undefined;
  payoutEdit.value.payment_account = "";
  await loadBankAccounts(payoutEdit.value.payment_entity_id);
};

const onEditAccountChange = () => {
  const accountId = payoutEdit.value.payment_entity_bank_account_id;
  if (!accountId) {
    payoutEdit.value.payment_account = "";
    return;
  }
  const target = activeBankAccounts.value.find(item => item.id === accountId);
  payoutEdit.value.payment_account = target ? toAccountLabel(target) : "";
};

const saveSecondaryEdit = async () => {
  if (!detail.value) return;
  if (!isSuperAdmin.value) {
    message("仅超级管理员可执行二次编辑", { type: "warning" });
    return;
  }

  const payload: {
    payment_method?: string;
    payment_entity_id?: number;
    payment_entity_bank_account_id?: number;
    payment_account?: string;
    payee_id?: number;
  } = {};

  if (payoutEdit.value.payment_method) {
    payload.payment_method = payoutEdit.value.payment_method;
  }
  if (payoutEdit.value.payment_entity_id) {
    payload.payment_entity_id = payoutEdit.value.payment_entity_id;
  }
  if (payoutEdit.value.payment_entity_bank_account_id) {
    payload.payment_entity_bank_account_id =
      payoutEdit.value.payment_entity_bank_account_id;
  }
  if (payoutEdit.value.payment_account.trim()) {
    payload.payment_account = payoutEdit.value.payment_account.trim();
  }
  if (payoutEdit.value.payee_id) {
    payload.payee_id = payoutEdit.value.payee_id;
  }

  if (Object.keys(payload).length === 0) {
    message("请至少填写一个可更新字段", { type: "warning" });
    return;
  }

  savingPayout.value = true;
  try {
    await updateBatchPayoutPlan(detail.value.id, payload);
    message("二次编辑保存成功", { type: "success" });
    await loadDetail();
    notifyChanged();
  } finally {
    savingPayout.value = false;
  }
};

const loadMeta = async () => {
  await Promise.all([
    listProjects({ page: 1, pageSize: 500 }).then(result => {
      projects.value = result.data;
    }),
    listEntities().then(result => {
      entities.value = result.data;
    }),
    loadWecomUsers()
  ]);
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const result = await getReimbursementBatch(batchId.value);
    detail.value = result.data;

    const report = await getBatchAuditReport(batchId.value);
    auditStatus.value = report.data.status;
    auditResult.value = report.data.result;
    syncVoucherEditorFromDetail();

    if (isSuperAdmin.value) {
      await syncEditFormFromDetail();
    }
  } finally {
    loading.value = false;
  }
};

const runAudit = async () => {
  actionLoading.value = true;
  try {
    await triggerBatchAudit(batchId.value);
    message("已触发智能审核", { type: "success" });
    await loadDetail();
    notifyChanged();
  } finally {
    actionLoading.value = false;
  }
};

const refreshAudit = async () => {
  const report = await getBatchAuditReport(batchId.value);
  auditStatus.value = report.data.status;
  auditResult.value = report.data.result;
  message(`智能审核状态：${report.data.status}`, { type: "info" });
};

const submitApproval = async () => {
  actionLoading.value = true;
  try {
    const result = await submitBatchApproval(batchId.value, undefined, {
      idempotencyKey: `reimbursement-batch-submit-${crypto.randomUUID()}`
    });
    message(`已提交审批：${result.data.instance_no}`, { type: "success" });
    await loadDetail();
    notifyChanged();
  } finally {
    actionLoading.value = false;
  }
};

const doMarkPaid = async () => {
  router.push(`/finance/reimbursement/payout?batch_id=${batchId.value}`);
};

onMounted(async () => {
  await loadMeta();
  await loadDetail();
});

watch(
  () => effectiveBatchId.value,
  async () => {
    await loadDetail();
  }
);
</script>

<template>
  <div class="batch-detail-page" v-loading="loading">
    <div class="page-header">
      <div>
        <div class="page-title">批次详情</div>
        <div class="page-subtitle">{{ detail?.batch_no || "加载中" }}</div>
      </div>
      <el-button @click="closeBatchDetail">{{
        props.drawerMode ? "关闭" : "返回"
      }}</el-button>
    </div>

    <template v-if="detail">
      <div class="summary-grid">
        <div class="summary-tile">
          <span class="tile-label">业务状态</span>
          <strong>{{ statusLabel(detail.status) }}</strong>
        </div>
        <div class="summary-tile">
          <span class="tile-label">总金额</span>
          <strong>¥{{ Number(detail.total_amount || 0).toFixed(2) }}</strong>
        </div>
        <div class="summary-tile">
          <span class="tile-label">单据数</span>
          <strong>{{ detail.item_count }}</strong>
        </div>
        <div class="summary-tile">
          <span class="tile-label">审批节点</span>
          <strong>{{
            detail.approval_instance?.current_node_name || "-"
          }}</strong>
        </div>
      </div>

      <div class="action-panel">
        <el-space wrap>
          <el-button type="primary" :loading="actionLoading" @click="runAudit">
            触发智能审核
          </el-button>
          <el-button :loading="actionLoading" @click="refreshAudit"
            >刷新审核状态</el-button
          >
          <el-button
            type="success"
            :loading="actionLoading"
            @click="submitApproval"
          >
            提交集中审批
          </el-button>
          <el-button
            type="warning"
            :loading="actionLoading"
            @click="doMarkPaid"
          >
            去集中打款登记
          </el-button>
          <el-button
            v-if="detail.approval_instance_id"
            @click="
              router.push(`/approval/detail/${detail.approval_instance_id}`)
            "
          >
            查看审批详情
          </el-button>
        </el-space>
      </div>

      <div class="info-grid">
        <section class="detail-section">
          <div class="section-title">基础信息</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="所属项目">{{
              toProjectLabel(detail.project_id)
            }}</el-descriptions-item>
            <el-descriptions-item label="被报销人">{{
              toUserLabel(detail.applicant_userid)
            }}</el-descriptions-item>
            <el-descriptions-item label="智能审核">{{
              aiAuditStatusLabel(detail.ai_audit_status)
            }}</el-descriptions-item>
            <el-descriptions-item label="审批状态">{{
              detail.approval_instance
                ? statusLabel(detail.approval_instance.status)
                : "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{
              formatBeijingDateTime(detail.created_at)
            }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{
              formatBeijingDateTime(detail.updated_at)
            }}</el-descriptions-item>
          </el-descriptions>
        </section>

        <section class="detail-section">
          <div class="section-title">收付款信息</div>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="付款方式">{{
              toPaymentMethodLabel(detail.payment_method)
            }}</el-descriptions-item>
            <el-descriptions-item label="收款账户">{{
              detail.payee
                ? `${detail.payee.name} · ${detail.payee.bank_name} · ${detail.payee.bank_account}`
                : "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="付款实体">{{
              detail.payment_entity
                ? `${detail.payment_entity.entity_name} (${detail.payment_entity.entity_code})`
                : toEntityLabel(detail.payment_entity_id)
            }}</el-descriptions-item>
            <el-descriptions-item label="付款账户">{{
              detail.payment_bank_account
                ? `${detail.payment_bank_account.bank_name}${
                    detail.payment_bank_account.bank_branch_no
                      ? `-${detail.payment_bank_account.bank_branch_no}`
                      : ""
                  } / ${detail.payment_bank_account.account_no}`
                : detail.payment_account || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="流水/打款">{{
              `${detail.payment_reference || "-"} / ${detail.paid_at || "-"}`
            }}</el-descriptions-item>
          </el-descriptions>
        </section>
      </div>

      <el-collapse class="maintenance-collapse">
        <el-collapse-item
          v-if="isSuperAdmin"
          title="超级管理员二次编辑"
          name="admin-edit"
        >
          <el-form class="compact-form" label-width="110px">
            <el-form-item label="付款方式">
              <el-select
                v-model="payoutEdit.payment_method"
                style="width: 220px"
                placeholder="选择付款方式"
              >
                <el-option
                  v-for="item in paymentMethodOptions"
                  :key="item.value || 'empty'"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="收款账户">
              <el-select
                v-model="payoutEdit.payee_id"
                filterable
                clearable
                style="width: min(560px, 100%)"
                placeholder="选择被报销人收款账户"
              >
                <el-option
                  v-for="item in internalPayees"
                  :key="item.id"
                  :label="`${item.name} / ${item.bank_name} / ${item.bank_account}`"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="付款实体">
              <el-select
                v-model="payoutEdit.payment_entity_id"
                filterable
                clearable
                style="width: 320px"
                placeholder="选择付款实体"
                @change="onEditEntityChange"
              >
                <el-option
                  v-for="item in activeEntities"
                  :key="item.id"
                  :label="item.entity_name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="付款账户">
              <el-select
                v-model="payoutEdit.payment_entity_bank_account_id"
                filterable
                clearable
                style="width: min(560px, 100%)"
                placeholder="选择付款账户"
                @change="onEditAccountChange"
              >
                <el-option
                  v-for="item in activeBankAccounts"
                  :key="item.id"
                  :label="toAccountLabel(item)"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="账户显示">
              <el-input
                v-model="payoutEdit.payment_account"
                style="width: min(560px, 100%)"
                placeholder="可手工修正展示文本"
              />
            </el-form-item>
            <el-form-item>
              <el-button
                :loading="savingPayout"
                type="primary"
                @click="saveSecondaryEdit"
              >
                保存二次编辑
              </el-button>
            </el-form-item>
          </el-form>
        </el-collapse-item>

        <el-collapse-item title="支付凭证" name="vouchers">
          <el-upload
            v-if="canMaintainBatchDetail"
            drag
            :show-file-list="false"
            :multiple="true"
            :disabled="uploadingVoucher"
            :http-request="uploadVoucher"
          >
            <div class="el-upload__text">
              拖拽凭证到这里，或 <em>点击上传</em>
            </div>
            <div class="el-upload__tip">支持上传打款截图、回单等凭证</div>
          </el-upload>

          <el-table
            v-if="voucherEditorRows.length > 0"
            :data="voucherEditorRows"
            size="small"
            border
            style="margin-top: 8px"
          >
            <el-table-column prop="file_name" label="文件名" min-width="240">
              <template #default="scope">
                {{ scope.row.file_name || scope.row.file_key }}
              </template>
            </el-table-column>
            <el-table-column prop="file_size" label="大小" width="120" />
            <el-table-column label="操作" width="180">
              <template #default="scope">
                <el-link
                  :href="fileUrl(scope.row.file_key)"
                  target="_blank"
                  type="primary"
                >
                  下载
                </el-link>
                <el-link
                  style="margin-left: 12px"
                  :href="fileUrl(scope.row.file_key)"
                  target="_blank"
                  type="primary"
                >
                  预览
                </el-link>
                <el-button
                  v-if="canMaintainBatchDetail"
                  link
                  type="danger"
                  style="margin-left: 12px"
                  @click="removeVoucherRow(scope.$index)"
                >
                  移除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂无支付凭证" />
          <div v-if="canMaintainBatchDetail" style="margin-top: 10px">
            <el-button
              type="primary"
              :loading="savingVouchers"
              @click="savePaymentVouchers"
            >
              保存支付凭证
            </el-button>
          </div>
        </el-collapse-item>

        <el-collapse-item title="查重风险与智能审核" name="audit">
          <div class="audit-grid">
            <el-table
              :data="detail.duplicate_summary || []"
              size="small"
              border
            >
              <el-table-column label="风险级别" width="140">
                <template #default="scope">
                  <el-tag
                    :type="invoiceRiskTagMap[scope.row.risk_level] || 'info'"
                    size="small"
                  >
                    {{ toInvoiceRiskLabel(scope.row.risk_level) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="cnt" label="数量" width="120" />
            </el-table>
            <div class="audit-report">
              <div class="audit-status">
                状态：{{ aiAuditStatusLabel(auditStatus) }}
              </div>
              <pre>{{ auditResult || "-" }}</pre>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>

      <section class="detail-section">
        <div class="section-title">批次信封明细</div>
        <el-table :data="detail?.items || []" border>
          <el-table-column prop="id" label="信封ID" width="90" />
          <el-table-column prop="envelope_no" label="信封编号" width="170" />
          <el-table-column prop="invoice_no" label="发票号" width="170" />
          <el-table-column prop="expense_date" label="费用日期" width="120" />
          <el-table-column prop="amount" label="金额" width="120" />
          <el-table-column prop="category" label="类别" width="120" />
          <el-table-column
            prop="description"
            label="说明"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column label="复核状态" width="120">
            <template #default="scope">{{
              precheckStatusLabel(scope.row.precheck_status)
            }}</template>
          </el-table-column>
          <el-table-column label="信封状态" width="120">
            <template #default="scope">{{
              statusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column
            label="单项AI结论"
            min-width="220"
            show-overflow-tooltip
          >
            <template #default="scope">{{
              scope.row.ai_reasonability_summary || "-"
            }}</template>
          </el-table-column>
          <el-table-column label="票据风险" width="120">
            <template #default="scope">
              <el-tag
                v-if="scope.row.invoice_review_highest_risk"
                :type="
                  invoiceRiskTagMap[scope.row.invoice_review_highest_risk] ||
                  'info'
                "
                size="small"
              >
                {{ toInvoiceRiskLabel(scope.row.invoice_review_highest_risk) }}
              </el-tag>
              <template v-else>-</template>
            </template>
          </el-table-column>
          <el-table-column label="附件" min-width="220">
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
                  class="attachment-row"
                >
                  <span class="attachment-name">{{
                    attachment.file_name || attachment.file_key
                  }}</span>
                  <el-link
                    :href="fileUrl(attachment.file_key)"
                    target="_blank"
                    type="primary"
                  >
                    查看
                  </el-link>
                </div>
              </template>
              <template v-else>-</template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button
                link
                type="primary"
                @click="openEnvelopeDetail(scope.row.id)"
              >
                详情
              </el-button>
              <el-button
                v-if="canMaintainBatchDetail"
                link
                type="warning"
                @click="openEditItemDialog(scope.row)"
              >
                编辑基础信息
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </template>

    <el-drawer
      v-model="envelopeDetailDrawerVisible"
      title="报销详情"
      size="82%"
      destroy-on-close
      append-to-body
      class="reimbursement-detail-drawer"
      @closed="onEnvelopeDetailClosed"
    >
      <ReimbursementDetail
        v-if="activeEnvelopeDetailId !== null"
        :envelope-id="activeEnvelopeDetailId"
        drawer-mode
        @close="closeEnvelopeDetail"
        @changed="onEnvelopeDetailChanged"
      />
    </el-drawer>

    <el-dialog
      v-model="editItemDialogVisible"
      title="编辑报销基础信息"
      width="560px"
      destroy-on-close
    >
      <el-form label-width="110px">
        <el-form-item label="发票号">
          <el-input v-model="editItemForm.invoice_no" clearable />
        </el-form-item>
        <el-form-item label="费用日期">
          <el-date-picker
            v-model="editItemForm.expense_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
            clearable
          />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number
            v-model="editItemForm.amount"
            :precision="2"
            :min="0"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="类别">
          <el-input v-model="editItemForm.category" clearable />
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="editItemForm.description"
            type="textarea"
            :rows="3"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editItemDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="savingItemBasic"
          @click="saveItemBasicInfo"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
:global(.reimbursement-batch-detail-drawer .el-drawer__body) {
  padding: 12px;
  background: #f5f7fa;
}

.batch-detail-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.page-subtitle {
  margin-top: 4px;
  color: #6b7280;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-tile {
  min-height: 82px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.summary-tile strong {
  display: block;
  margin-top: 8px;
  overflow: hidden;
  font-size: 20px;
  font-weight: 600;
  color: #111827;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-label {
  font-size: 13px;
  color: #6b7280;
}

.action-panel,
.detail-section,
.maintenance-collapse {
  padding: 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.info-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.section-title {
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.compact-form {
  max-width: 760px;
}

.audit-grid {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
}

.audit-report {
  min-width: 0;
}

.audit-status {
  margin-bottom: 8px;
  color: #4b5563;
}

.audit-report pre {
  max-height: 320px;
  padding: 12px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.attachment-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.attachment-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1200px) {
  .summary-grid,
  .info-grid,
  .audit-grid {
    grid-template-columns: 1fr;
  }
}
</style>
