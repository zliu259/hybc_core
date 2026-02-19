<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  listProjects,
  getProjectFinancialSummary,
  type Project
} from "@/api/project";

defineOptions({ name: "ReceiptDashboard" });

const projects = ref<Project[]>([]);
const projectId = ref<number | undefined>(undefined);
const loading = ref(false);

const summary = ref({
  outboundPaidAmount: 0,
  inboundReceivedAmount: 0,
  inboundInvoicedAmount: 0,
  reimbursementAmount: 0,
  receiptCount: 0
});

const selectedProject = computed(() =>
  projects.value.find(item => item.id === projectId.value)
);

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
  if (!projectId.value && result.data.length > 0) {
    projectId.value = result.data[0].id;
  }
};

const loadSummary = async () => {
  if (!projectId.value) return;
  loading.value = true;
  try {
    const result = await getProjectFinancialSummary(projectId.value);
    summary.value = {
      outboundPaidAmount: result.data.outboundPaidAmount,
      inboundReceivedAmount: result.data.inboundReceivedAmount,
      inboundInvoicedAmount: result.data.inboundInvoicedAmount,
      reimbursementAmount: result.data.reimbursementAmount,
      receiptCount: result.data.receiptCount
    };
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await loadProjects();
  await loadSummary();
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
        <span>收款统计仪表盘</span>
        <div>
          <el-select
            v-model="projectId"
            filterable
            style="width: 260px; margin-right: 8px"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
          <el-button type="primary" @click="loadSummary">刷新</el-button>
        </div>
      </div>
    </template>

    <el-alert
      v-if="selectedProject"
      :title="`当前项目：${selectedProject.project_name}`"
      type="info"
      :closable="false"
      style="margin-bottom: 12px"
    />

    <el-row :gutter="12">
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div style="font-size: 13px; color: #666">收款合同已开票</div>
          <div style="font-size: 26px; font-weight: 700; margin-top: 8px">
            {{ summary.inboundInvoicedAmount.toFixed(2) }}
          </div>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div style="font-size: 13px; color: #666">收款合同已收款</div>
          <div style="font-size: 26px; font-weight: 700; margin-top: 8px">
            {{ summary.inboundReceivedAmount.toFixed(2) }}
          </div>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div style="font-size: 13px; color: #666">收款登记笔数</div>
          <div style="font-size: 26px; font-weight: 700; margin-top: 8px">
            {{ summary.receiptCount }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :md="12" :xs="24">
        <el-card shadow="never">
          <div style="font-size: 13px; color: #666">对外付款已支付</div>
          <div style="font-size: 24px; font-weight: 700; margin-top: 8px">
            {{ summary.outboundPaidAmount.toFixed(2) }}
          </div>
        </el-card>
      </el-col>
      <el-col :md="12" :xs="24">
        <el-card shadow="never">
          <div style="font-size: 13px; color: #666">报销已审批/已付款总额</div>
          <div style="font-size: 24px; font-weight: 700; margin-top: 8px">
            {{ summary.reimbursementAmount.toFixed(2) }}
          </div>
        </el-card>
      </el-col>
    </el-row>
  </el-card>
</template>
