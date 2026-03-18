<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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
  createReimbursementBatch,
  listReimbursementEnvelopes,
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

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  status: ""
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

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
    const result = await listReimbursementEnvelopes({
      page: 1,
      pageSize: 500,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim()
    });
    candidates.value = result.data.filter(
      item => !["paid", "rejected", "deleted"].includes(item.status)
    );
    candidateSelectedIds.value = [];
  } finally {
    candidateLoading.value = false;
  }
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

  creatingAndSubmitting.value = true;
  try {
    const result = await createReimbursementBatch({
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim(),
      envelope_ids:
        candidateSelectedIds.value.length > 0
          ? candidateSelectedIds.value
          : undefined
    });

    await submitBatchApproval(result.data.id);
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
  await Promise.all([loadProjects(), loadWecomUsers()]);
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
      title="按“项目 + 申请人”筛选后，系统自动列出未完成报销条目；勾选可送审条目后可一键创建并集中送审。"
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
      <el-form-item label="申请人">
        <el-select
          v-model="filters.applicant_userid"
          clearable
          filterable
          style="width: 240px"
          placeholder="请选择申请人"
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
      <el-button type="primary" @click="loadData">查询批次</el-button>
      <el-button @click="loadCandidates">查询候选报销</el-button>
      <el-button @click="autoSelectSubmittable"
        >自动勾选可送审（已收件+预审通过）</el-button
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
      <el-table-column label="预审状态" width="130">
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
      <el-table-column prop="applicant_userid" label="申报人" width="140" />
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="total_amount" label="总金额" width="120" />
      <el-table-column label="AI审计" width="120">
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
      <el-table-column prop="applicant_userid" label="申报人" width="140" />
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
