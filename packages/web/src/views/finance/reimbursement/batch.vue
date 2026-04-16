<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  aiAuditStatusLabel,
  channelLabel,
  precheckStatusLabel,
  statusLabel
} from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import {
  createReimbursementBatch,
  listReimbursementBatchCandidates,
  listReimbursementBatches,
  submitBatchApproval,
  type ReimbursementEnvelope,
  type ReimbursementBatch
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementBatchList" });

const router = useRouter();
const loading = ref(false);
const list = ref<ReimbursementBatch[]>([]);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const candidateLoading = ref(false);
const historyLoading = ref(false);
const candidates = ref<ReimbursementEnvelope[]>([]);
const candidateSelectedIds = ref<number[]>([]);
const historyRows = ref<ReimbursementBatch[]>([]);
const entities = ref<Entity[]>([]);
const bankAccounts = ref<EntityBankAccount[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  status: "",
  payment_method: "",
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined,
  payment_account: ""
});

const paymentMethodLabelMap: Record<string, string> = {
  transfer: "对公转账",
  bank_transfer: "对公转账",
  对公转账: "对公转账",
  cash: "现金",
  现金: "现金",
  bill: "票据",
  票据: "票据",
  other: "其他",
  其他: "其他"
};

const toPaymentMethodLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentMethodLabelMap[value] ?? value;
};

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
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

const creatingAndSubmitting = ref(false);

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementBatches({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: filters.value.status || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const loadHistory = async () => {
  historyLoading.value = true;
  try {
    const [paid, rejected] = await Promise.all([
      listReimbursementBatches({ status: "paid", page: 1, pageSize: 200 }),
      listReimbursementBatches({ status: "rejected", page: 1, pageSize: 200 })
    ]);
    historyRows.value = [...paid.data, ...rejected.data].sort(
      (a, b) => b.id - a.id
    );
  } finally {
    historyLoading.value = false;
  }
};

const loadCandidates = async () => {
  if (!filters.value.project_id || !filters.value.applicant_userid.trim()) {
    candidates.value = [];
    candidateSelectedIds.value = [];
    return;
  }

  candidateLoading.value = true;
  try {
    const result = await listReimbursementBatchCandidates({
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim()
    });
    candidates.value = result.data;
    candidateSelectedIds.value = [];
  } finally {
    candidateLoading.value = false;
  }
};

const loadEntities = async () => {
  const result = await listEntities();
  entities.value = result.data;
};

const toBankAccountLabel = (item: EntityBankAccount) => {
  const branch = item.bank_branch_no?.trim();
  return `${item.bank_name}${branch ? `-${branch}` : ""} / ${item.account_no}`;
};

const onPaymentEntityChange = async () => {
  filters.value.payment_entity_bank_account_id = undefined;
  filters.value.payment_account = "";
  if (!filters.value.payment_entity_id) {
    bankAccounts.value = [];
    return;
  }
  const result = await listEntityBankAccounts(filters.value.payment_entity_id);
  bankAccounts.value = result.data;
};

const onPaymentBankAccountChange = () => {
  if (!filters.value.payment_entity_bank_account_id) {
    filters.value.payment_account = "";
    return;
  }
  const target = activeBankAccounts.value.find(
    item => item.id === filters.value.payment_entity_bank_account_id
  );
  filters.value.payment_account = target ? toBankAccountLabel(target) : "";
};

const autoSelectSubmittable = () => {
  candidateSelectedIds.value = candidates.value
    .filter(
      item =>
        item.status === "received" &&
        item.precheck_status === "approved" &&
        !item.batch_id
    )
    .map(item => item.id);
};

const submitCreateAndApproval = async () => {
  if (!filters.value.project_id || !filters.value.applicant_userid.trim()) {
    message("请填写项目和申报人", { type: "warning" });
    return;
  }

  if (!filters.value.payment_method) {
    message("请选择收款方式", { type: "warning" });
    return;
  }
  if (!filters.value.payment_entity_id || !filters.value.payment_entity_bank_account_id) {
    message("请选择付款实体和付款账户", { type: "warning" });
    return;
  }
  if (!filters.value.payment_account.trim()) {
    message("请补全付款账户显示信息", { type: "warning" });
    return;
  }
  if (candidateSelectedIds.value.length === 0) {
    message("请先从候选条目中勾选要送审的报销单", { type: "warning" });
    return;
  }

  const selectedRows = candidates.value.filter(item =>
    candidateSelectedIds.value.includes(item.id)
  );
  const selectedTotalAmount = selectedRows.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );
  const paymentEntityLabel = entityNameMap.value.get(filters.value.payment_entity_id) || "-";
  const paymentAccountLabel =
    activeBankAccounts.value.find(
      item => item.id === filters.value.payment_entity_bank_account_id
    )?.account_no || "-";

  try {
    await ElMessageBox.confirm(
      `即将创建并送审：${selectedRows.length} 条报销，合计 ¥${selectedTotalAmount.toFixed(
        2
      )}。\n收款方式：${toPaymentMethodLabel(filters.value.payment_method)}\n付款实体：${paymentEntityLabel}\n付款账号：${paymentAccountLabel}\n\n请确认信息无误后继续。`,
      "二次确认：创建并送审",
      {
        type: "warning",
        confirmButtonText: "确认送审",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }

  creatingAndSubmitting.value = true;
  try {
    const createKey = `reimbursement-batch-create-${crypto.randomUUID()}`;
    const result = await createReimbursementBatch({
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim(),
      payment_method: filters.value.payment_method || undefined,
      payment_entity_id: filters.value.payment_entity_id,
      payment_entity_bank_account_id: filters.value.payment_entity_bank_account_id,
      payment_account: filters.value.payment_account.trim(),
      envelope_ids:
        candidateSelectedIds.value.length > 0
          ? candidateSelectedIds.value
          : undefined
    }, { idempotencyKey: createKey });

    await submitBatchApproval(result.data.id, {
      payment_method: filters.value.payment_method || undefined,
      payment_entity_id: filters.value.payment_entity_id,
      payment_entity_bank_account_id: filters.value.payment_entity_bank_account_id,
      payment_account: filters.value.payment_account.trim()
    }, {
      idempotencyKey: `reimbursement-batch-submit-${crypto.randomUUID()}`
    });
    message(`批次已创建并送审：${result.data.batch_no}`, { type: "success" });

    await Promise.all([loadData(), loadCandidates(), loadHistory()]);
    router.push(`/finance/reimbursement/batch/${result.data.id}`);
  } catch {
    message("提交失败", { type: "error" });
  } finally {
    creatingAndSubmitting.value = false;
  }
};

const onCandidateSelectionChange = (selection: ReimbursementEnvelope[]) => {
  candidateSelectedIds.value = selection.map(item => item.id);
};

const openDetail = (id: number) => {
  router.push(`/finance/reimbursement/batch/${id}`);
};

onMounted(async () => {
  await Promise.all([loadProjects(), loadWecomUsers(), loadEntities()]);
  await Promise.all([loadData(), loadHistory()]);
});

watch(
  () => [filters.value.project_id, filters.value.applicant_userid],
  () => {
    loadCandidates();
  }
);
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>报销集中审批与历史中心</span>
        <el-space>
          <el-button @click="loadCandidates">刷新候选条目</el-button>
          <el-button
            type="primary"
            :loading="creatingAndSubmitting"
            @click="submitCreateAndApproval"
            >创建并送审</el-button
          >
        </el-space>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      title="按“项目 + 被报销人”筛选后，系统自动列出未完成报销条目；可选择收款方式并一键创建集中送审。"
      style="margin-bottom: 12px"
    />

    <el-form inline>
      <el-form-item label="所属项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="被报销人">
        <el-select
          v-model="filters.applicant_userid"
          clearable
          filterable
          style="width: 240px"
          placeholder="请选择被报销人"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="批次状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已拒绝" value="rejected" />
          <el-option label="已付款" value="paid" />
        </el-select>
      </el-form-item>
      <el-form-item label="收款方式">
        <el-select v-model="filters.payment_method" clearable style="width: 160px">
          <el-option label="对公转账" value="transfer" />
          <el-option label="现金" value="cash" />
          <el-option label="票据" value="bill" />
          <el-option label="其他" value="other" />
        </el-select>
      </el-form-item>
      <el-form-item label="付款实体">
        <el-select
          v-model="filters.payment_entity_id"
          filterable
          clearable
          style="width: 220px"
          placeholder="请选择付款实体"
          @change="onPaymentEntityChange"
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
          v-model="filters.payment_entity_bank_account_id"
          filterable
          clearable
          style="width: 260px"
          placeholder="请选择付款账户"
          @change="onPaymentBankAccountChange"
        >
          <el-option
            v-for="item in activeBankAccounts"
            :key="item.id"
            :label="toBankAccountLabel(item)"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="账户显示">
        <el-input
          v-model="filters.payment_account"
          style="width: 240px"
          placeholder="可手工修正"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询批次</el-button>
      <el-button @click="loadCandidates">查询候选报销</el-button>
      <el-button @click="autoSelectSubmittable"
        >自动勾选可送审（已收件+复核通过）</el-button
      >
    </el-form>

    <el-table
      :data="candidates"
      :loading="candidateLoading"
      stripe
      style="margin-top: 12px"
      @selection-change="onCandidateSelectionChange"
    >
      <el-table-column type="selection" width="52" />
      <el-table-column prop="envelope_no" label="信封编号" width="160" />
      <el-table-column label="状态" width="130">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="复核状态" width="130">
        <template #default="scope">{{
          precheckStatusLabel(scope.row.precheck_status)
        }}</template>
      </el-table-column>
      <el-table-column label="通道" width="110">
        <template #default="scope">{{
          channelLabel(scope.row.channel)
        }}</template>
      </el-table-column>
      <el-table-column prop="invoice_no" label="发票号" min-width="180" />
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="updated_at" label="最近更新时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="
              router.push(`/finance/reimbursement/detail/${scope.row.id}`)
            "
            >查看</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-divider content-position="left">审批批次（进行中）</el-divider>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="batch_no" label="批次号" width="160" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="被报销人" width="140" />
      <el-table-column label="收款方式" width="120">
        <template #default="scope">{{
          toPaymentMethodLabel(scope.row.payment_method)
        }}</template>
      </el-table-column>
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="total_amount" label="总金额" width="120" />
      <el-table-column label="智能审核" width="120">
        <template #default="scope">{{
          aiAuditStatusLabel(scope.row.ai_audit_status)
        }}</template>
      </el-table-column>
      <el-table-column label="审批状态" width="120">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row.id)"
            >详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />

    <el-divider content-position="left">历史完成（财务/领导）</el-divider>

    <el-table :data="historyRows" :loading="historyLoading" stripe>
      <el-table-column prop="batch_no" label="批次号" width="170" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="被报销人" width="140" />
      <el-table-column label="收款方式" width="120">
        <template #default="scope">{{
          toPaymentMethodLabel(scope.row.payment_method)
        }}</template>
      </el-table-column>
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="total_amount" label="总金额" width="120" />
      <el-table-column label="结果状态" width="120">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column prop="updated_at" label="最近更新时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row.id)"
            >详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
