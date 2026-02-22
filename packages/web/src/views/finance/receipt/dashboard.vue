<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import echarts from "@/plugins/echarts";
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

const chartRef = ref<HTMLElement | null>(null);
let chartInstance: ReturnType<typeof echarts.init> | null = null;

const selectedProject = computed(() =>
  projects.value.find(item => item.id === projectId.value)
);

const amountFormatter = (value: number) => {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const buildChartOption = () => {
  const labels = ["应收已开票", "应收已到账", "对外付款", "报销总额"];
  const values = [
    summary.value.inboundInvoicedAmount,
    summary.value.inboundReceivedAmount,
    summary.value.outboundPaidAmount,
    summary.value.reimbursementAmount
  ];
  return {
    grid: {
      top: 24,
      right: 18,
      bottom: 30,
      left: 42
    },
    tooltip: {
      trigger: "axis"
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: {
        color: "#6e6458"
      }
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#6e6458"
      },
      splitLine: {
        lineStyle: {
          color: "#e8ddc8"
        }
      }
    },
    series: [
      {
        type: "bar",
        data: values,
        itemStyle: {
          color: "#2f6c5f",
          borderRadius: [6, 6, 0, 0]
        },
        barWidth: 36,
        label: {
          show: true,
          position: "top",
          formatter: ({ value }) => amountFormatter(Number(value))
        }
      }
    ]
  };
};

const renderChart = async () => {
  await nextTick();
  if (!chartRef.value) return;
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value);
  }
  chartInstance.setOption(buildChartOption());
};

const loadProjectsData = async () => {
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
    await renderChart();
  } finally {
    loading.value = false;
  }
};

const onResize = () => {
  chartInstance?.resize();
};

onMounted(async () => {
  await loadProjectsData();
  await loadSummary();
  window.addEventListener("resize", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  chartInstance?.dispose();
  chartInstance = null;
});
</script>

<template>
  <el-card shadow="never" :loading="loading" class="snapshot-card">
    <template #header>
      <div class="header">
        <div>
          <div class="title">财务快照看板</div>
          <div class="sub">项目维度应收/应付与报销总览</div>
        </div>
        <div class="header__ops">
          <el-select v-model="projectId" filterable style="width: 260px">
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
      class="mb-3"
    />

    <el-row :gutter="12">
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">收款合同已开票</div>
          <div class="kpi-value">¥{{ amountFormatter(summary.inboundInvoicedAmount) }}</div>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">收款合同已收款</div>
          <div class="kpi-value">¥{{ amountFormatter(summary.inboundReceivedAmount) }}</div>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">收款登记笔数</div>
          <div class="kpi-value">{{ summary.receiptCount }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" class="mt-3">
      <el-col :md="12" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">对外付款已支付</div>
          <div class="kpi-value">¥{{ amountFormatter(summary.outboundPaidAmount) }}</div>
        </el-card>
      </el-col>
      <el-col :md="12" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">报销已审批/已付款总额</div>
          <div class="kpi-value">¥{{ amountFormatter(summary.reimbursementAmount) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt-3">
      <template #header>
        <span>结构化财务趋势</span>
      </template>
      <div ref="chartRef" class="chart" />
    </el-card>
  </el-card>
</template>

<style scoped>
.snapshot-card {
  background: #fffaf2;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header__ops {
  display: flex;
  gap: 8px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.kpi-label {
  font-size: 13px;
  color: #6e6458;
}

.kpi-value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: #2a241d;
}

.chart {
  width: 100%;
  height: 360px;
}

.mb-3 {
  margin-bottom: 12px;
}

.mt-3 {
  margin-top: 12px;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .header__ops {
    width: 100%;
  }
}
</style>
