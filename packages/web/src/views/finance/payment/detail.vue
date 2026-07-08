<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import { useUserStoreHook } from "@/store/modules/user";
import {
  isApprovalFinishedLocked,
  isApprovalInProgress
} from "../shared/approvalLock";
import AdminEditPanel from "./components/AdminEditPanel.vue";
import ApprovalActionPanel from "./components/ApprovalActionPanel.vue";
import PayoutPanel from "./components/PayoutPanel.vue";
import PaymentInfoCard from "./components/PaymentInfoCard.vue";

defineOptions({ name: "PaymentDetail" });

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const loading = ref(false);

const isCreate = computed(() => route.params.id === "create");
const requestId = computed(() => Number(route.params.id));
const inWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));
const paymentListPath = computed(() =>
  inWorkspaceRoute.value ? "/workspace/payment/wizard" : "/finance/payment"
);
const autoEdit = computed(() => route.query.edit === "1");

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
    isCreate: isCreate.value,
    approvalInstanceId: detail.value?.approval_instance_id,
    bizStatus: detail.value?.status,
    unlockedStatuses: ["draft"]
  })
);
const canEditFields = computed(
  () =>
    isCreate.value ||
    (!inApprovalFlow.value && !approvalFinishedLock.value) ||
    (isSuperAdmin.value && superEditMode.value)
);

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
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getPaymentRequest(requestId.value);
    detail.value = result.data;
    superEditMode.value = false;
    superEditNote.value = "";
    const rr = await getRiskReport(requestId.value);
    riskStatus.value = rr.data.status;
    riskReport.value = rr.data.result;
    await loadApprovalDetail(result.data.approval_instance_id);
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await loadRefs();
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
      :visible="isSuperAdmin && !isCreate"
      v-model:edit-mode="superEditMode"
      v-model:edit-note="superEditNote"
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
      @refresh="loadDetail"
    />

    <ApprovalActionPanel
      :detail="detail"
      :approval-detail="approvalDetail"
      :risk-status="riskStatus"
      :risk-report="riskReport"
    />
  </el-card>
</template>
