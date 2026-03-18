<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { precheckStatusLabel, statusLabel } from "@/utils/enum-labels";
import {
  getBatchAuditReport,
  getReimbursementBatch,
  submitBatchApproval,
  triggerBatchAudit,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementBatchDetail" });

const route = useRoute();
const router = useRouter();
const batchId = computed(() => Number(route.params.id));

const loading = ref(false);
const actionLoading = ref(false);
const detail = ref<ReimbursementBatchDetail | null>(null);
const auditResult = ref<Record<string, unknown> | string | null>(null);
const auditStatus = ref("none");

const loadDetail = async () => {
  loading.value = true;
  try {
    const result = await getReimbursementBatch(batchId.value);
    detail.value = result.data;

    const report = await getBatchAuditReport(batchId.value);
    auditStatus.value = report.data.status;
    auditResult.value = report.data.result;
  } finally {
    loading.value = false;
  }
};

const runAudit = async () => {
  actionLoading.value = true;
  try {
    await triggerBatchAudit(batchId.value);
    message("已触发AI审计", { type: "success" });
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
};

const refreshAudit = async () => {
  const report = await getBatchAuditReport(batchId.value);
  auditStatus.value = report.data.status;
  auditResult.value = report.data.result;
  message(`AI审计状态：${report.data.status}`, { type: "info" });
};

const submitApproval = async () => {
  actionLoading.value = true;
  try {
    const result = await submitBatchApproval(batchId.value);
    message(`已提交审批：${result.data.instance_no}`, { type: "success" });
    await loadDetail();
  } finally {
    actionLoading.value = false;
  }
};

const doMarkPaid = async () => {
  router.push(`/finance/reimbursement/payout?batch_id=${batchId.value}`);
};

onMounted(loadDetail);
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
        <span>批次详情 - {{ detail?.batch_no || "" }}</span>
        <el-button @click="router.push('/finance/reimbursement/batch')"
          >返回</el-button
        >
      </div>
    </template>

    <el-descriptions v-if="detail" :column="2" border>
      <el-descriptions-item label="批次号">{{
        detail.batch_no
      }}</el-descriptions-item>
      <el-descriptions-item label="状态">{{
        detail.status
      }}</el-descriptions-item>
      <el-descriptions-item label="项目ID">{{
        detail.project_id
      }}</el-descriptions-item>
      <el-descriptions-item label="申报人">{{
        detail.applicant_userid
      }}</el-descriptions-item>
      <el-descriptions-item label="信封数">{{
        detail.item_count
      }}</el-descriptions-item>
      <el-descriptions-item label="总金额">{{
        detail.total_amount
      }}</el-descriptions-item>
      <el-descriptions-item label="AI审计状态">{{
        detail.ai_audit_status
      }}</el-descriptions-item>
      <el-descriptions-item label="审批实例">{{
        detail.approval_instance_id || "-"
      }}</el-descriptions-item>
    </el-descriptions>

    <div style="margin-top: 12px">
      <el-space>
        <el-button type="primary" :loading="actionLoading" @click="runAudit"
          >触发AI审计</el-button
        >
        <el-button :loading="actionLoading" @click="refreshAudit"
          >刷新AI审计</el-button
        >
        <el-button
          type="success"
          :loading="actionLoading"
          @click="submitApproval"
          >提交集中审批</el-button
        >
        <el-button type="warning" :loading="actionLoading" @click="doMarkPaid"
          >去集中打款登记</el-button
        >
        <el-button
          v-if="detail?.approval_instance_id"
          @click="
            router.push(`/approval/detail/${detail.approval_instance_id}`)
          "
        >
          查看审批详情
        </el-button>
      </el-space>
    </div>

    <el-card shadow="never" style="margin-top: 16px" header="AI审计报告">
      <div style="margin-bottom: 8px">状态：{{ auditStatus }}</div>
      <pre style="white-space: pre-wrap; word-break: break-word">{{
        auditResult || "-"
      }}</pre>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px" header="批次信封明细">
      <el-table :data="detail?.items || []">
        <el-table-column prop="id" label="信封ID" width="90" />
        <el-table-column prop="envelope_no" label="信封编号" width="160" />
        <el-table-column prop="invoice_no" label="发票号" width="180" />
        <el-table-column prop="amount" label="金额" width="120" />
        <el-table-column label="预审" width="120">
          <template #default="scope">{{
            precheckStatusLabel(scope.row.precheck_status)
          }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope">{{
            statusLabel(scope.row.status)
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="
                router.push(`/finance/reimbursement/detail/${scope.row.id}`)
              "
            >
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </el-card>
</template>
