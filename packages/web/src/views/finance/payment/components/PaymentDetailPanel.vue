<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  getPaymentRequest,
  getRiskReport,
  listPayees,
  type Payee,
  type PaymentRequestDetail
} from "@/api/payment";
import { getApprovalDetail, type ApprovalDetailResponse } from "@/api/approval";
import { listContracts, type Contract } from "@/api/contract";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import {
  isApprovalFinishedLocked,
  isApprovalInProgress
} from "../../shared/approvalLock";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import {
  paymentStatusTagType,
  toPaymentMethodLabel,
  toPaymentStatusLabel,
  type PaymentTagType
} from "../payment-labels";
import AdminEditPanel from "./AdminEditPanel.vue";
import ApprovalActionPanel from "./ApprovalActionPanel.vue";
import PayoutPanel from "./PayoutPanel.vue";
import PaymentInfoCard from "./PaymentInfoCard.vue";

defineOptions({ name: "PaymentDetailPanel" });

const props = withDefaults(
  defineProps<{ requestId: number; autoEdit?: boolean }>(),
  { autoEdit: false }
);
const emit = defineEmits<{ (e: "back"): void }>();

const userStore = useUserStoreHook();
const loading = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const projects = ref<Project[]>([]);
const entities = ref<Entity[]>([]);
const entityBankAccountMap = ref<Record<number, EntityBankAccount[]>>({});
const detail = ref<PaymentRequestDetail | null>(null);
const approvalDetail = ref<ApprovalDetailResponse | null>(null);
const riskStatus = ref("none");
const riskReport = ref<Record<string, unknown> | null>(null);

const superEditMode = ref(false);
const superEditNote = ref("");

const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);
const inApprovalFlow = computed(() =>
  isApprovalInProgress(detail.value?.status)
);
const approvalFinishedLock = computed(() =>
  isApprovalFinishedLocked({
    isCreate: false,
    approvalInstanceId: detail.value?.approval_instance_id,
    bizStatus: detail.value?.status,
    unlockedStatuses: ["draft"]
  })
);
const canEditFields = computed(
  () =>
    (!inApprovalFlow.value && !approvalFinishedLock.value) ||
    (isSuperAdmin.value && superEditMode.value)
);

const riskTagTypeMap: Record<string, PaymentTagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};
const riskStatusLabelMap: Record<string, string> = {
  none: "未触发",
  pending: "评估中",
  completed: "已完成",
  failed: "评估失败"
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

const categoryLabel = computed(() => {
  const category = detail.value?.category;
  if (!category) return "-";
  return paymentCategoryLabelMap[category] ?? category;
});

const projectLabel = computed(() => {
  const target = projects.value.find(
    item => item.id === detail.value?.project_id
  );
  return target ? `${target.project_name} (${target.project_code})` : "-";
});

const payeeLabel = computed(() => {
  const payee = detail.value?.payee;
  if (!payee) return "-";
  const tail = payee.bank_account ? payee.bank_account.slice(-4) : "";
  return tail ? `${payee.name}（尾号${tail}）` : payee.name;
});

const applicantLabel = computed(() => {
  const userid = detail.value?.applicant_userid;
  if (!userid) return "-";
  const target = wecomUsers.value.find(item => item.userid === userid);
  return target?.name || userid;
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
  loading.value = true;
  try {
    const result = await getPaymentRequest(props.requestId);
    detail.value = result.data;
    superEditMode.value = false;
    superEditNote.value = "";
    const rr = await getRiskReport(props.requestId);
    riskStatus.value = rr.data.status;
    riskReport.value = rr.data.result;
    await loadApprovalDetail(result.data.approval_instance_id);
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([loadRefs(), loadWecomUsers()]);
    await loadDetail();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="payment-detail-panel">
    <FinanceDetailHeader
      serial-label="流水号"
      :serial="detail?.serial_no ?? null"
      amount-label="申请金额"
      :amount="detail?.amount"
      :amount-cn="detail?.amount_cn ?? null"
    >
      <template #tags>
        <el-tag
          v-if="detail"
          :type="paymentStatusTagType[detail.status] ?? 'info'"
        >
          {{ toPaymentStatusLabel(detail.status) }}
        </el-tag>
        <el-tag
          v-if="detail"
          :type="riskTagTypeMap[riskStatus] ?? 'info'"
          effect="plain"
        >
          AI风险：{{ riskStatusLabelMap[riskStatus] ?? riskStatus }}
        </el-tag>
      </template>
      <template #meta>
        <span>所属项目：{{ projectLabel }}</span>
        <span>收款人：{{ payeeLabel }}</span>
        <span>付款类别：{{ categoryLabel }}</span>
        <span
          >付款方式：{{ toPaymentMethodLabel(detail?.payment_method) }}</span
        >
        <span>预计付款日：{{ detail?.expected_payment_date || "-" }}</span>
        <span>申请人：{{ applicantLabel }}</span>
      </template>
      <template #actions>
        <el-button @click="emit('back')">返回</el-button>
      </template>
    </FinanceDetailHeader>

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

    <PayoutPanel
      :detail="detail"
      :entities="entities"
      :entity-bank-account-map="entityBankAccountMap"
      :in-approval-flow="inApprovalFlow"
      :contracts="contracts"
      :approval-detail="approvalDetail"
      @refresh="loadDetail"
    />

    <AdminEditPanel
      v-model:edit-mode="superEditMode"
      v-model:edit-note="superEditNote"
      :visible="isSuperAdmin"
    />

    <PaymentInfoCard
      :detail="detail"
      :contracts="contracts"
      :payees="payees"
      :projects="projects"
      :entities="entities"
      :entity-bank-account-map="entityBankAccountMap"
      :can-edit-fields="canEditFields"
      :super-edit-mode="superEditMode"
      :super-edit-note="superEditNote"
      :auto-edit="autoEdit"
      :wecom-users="wecomUsers"
      @refresh="loadDetail"
    />

    <ApprovalActionPanel
      :detail="detail"
      :approval-detail="approvalDetail"
      :risk-status="riskStatus"
      :risk-report="riskReport"
      :wecom-users="wecomUsers"
    />
  </div>
</template>

<style scoped>
.payment-detail-panel {
  min-height: 240px;
}
</style>
