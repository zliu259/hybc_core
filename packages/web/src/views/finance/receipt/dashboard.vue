<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import echarts from "@/plugins/echarts";
import { listProjects, type Project } from "@/api/project";
import {
  getFinanceSnapshot,
  type FinanceSnapshotDetail,
  type FinanceSnapshotPeriodType
} from "@/api/dashboard";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "ReceiptDashboard" });

const router = useRouter();
const loading = ref(false);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const currentYear = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");

const filters = ref({
  period_type: "month" as FinanceSnapshotPeriodType,
  period: `${currentYear}-${currentMonth}`,
  project_id: undefined as number | undefined,
  admin_userid: "",
  biz_type: "all" as "all" | "outbound" | "internal" | "receipt"
});

const snapshot = ref<{
  filters: {
    period_type: FinanceSnapshotPeriodType;
    period: string;
    start_date: string;
    end_date: string;
  };
  summary: {
    outbound: {
      count: number;
      total_amount: number;
      completed_amount: number;
      pending_count: number;
    };
    internal: {
      count: number;
      total_amount: number;
      completed_amount: number;
      pending_count: number;
    };
    receipt: {
      count: number;
      total_amount: number;
      completed_amount: number;
      pending_count: number;
    };
    total_amount: number;
  };
  charts: {
    trend: Array<{
      bucket: string;
      outbound_amount: number;
      internal_amount: number;
      receipt_amount: number;
      total_amount: number;
    }>;
    structure: Array<{
      biz_type: "outbound" | "internal" | "receipt";
      biz_type_label: string;
      amount: number;
    }>;
    status_breakdown: Array<{
      biz_type: "outbound" | "internal" | "receipt";
      biz_type_label: string;
      status: string;
      count: number;
      amount: number;
    }>;
  };
  details: FinanceSnapshotDetail[];
}>({
  filters: {
    period_type: "month",
    period: `${currentYear}-${currentMonth}`,
    start_date: `${currentYear}-${currentMonth}-01`,
    end_date: `${currentYear}-${currentMonth}-31`
  },
  summary: {
    outbound: {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    },
    internal: {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    },
    receipt: {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    },
    total_amount: 0
  },
  charts: {
    trend: [],
    structure: [],
    status_breakdown: []
  },
  details: []
});

const trendChartRef = ref<HTMLElement | null>(null);
const structureChartRef = ref<HTMLElement | null>(null);
let trendChart: ReturnType<typeof echarts.init> | null = null;
let structureChart: ReturnType<typeof echarts.init> | null = null;

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const amountFormatter = (value: number) => {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const toStatusLabel = (bizType: string, status: string) => {
  if (bizType === "outbound") {
    if (status === "draft") return "草稿";
    if (status === "pending_approval") return "审批中";
    if (status === "approved") return "已审批";
    if (status === "paid") return "已付款";
    if (status === "rejected") return "已驳回";
    return status;
  }
  if (bizType === "internal") {
    if (status === "draft") return "草稿";
    if (status === "pending_approval") return "审批中";
    if (status === "approved") return "已审批";
    if (status === "paid") return "已支付";
    if (status === "rejected") return "已驳回";
    return status;
  }
  if (status === "recorded") return "已登记";
  if (status === "reversed") return "已冲销";
  return status;
};

const renderCharts = async () => {
  await nextTick();

  if (trendChartRef.value) {
    if (!trendChart) {
      trendChart = echarts.init(trendChartRef.value);
    }

    const trend = snapshot.value.charts.trend;
    trendChart.setOption({
      tooltip: { trigger: "axis" },
      legend: {
        data: ["对外付款", "对内付款", "收款", "合计"]
      },
      grid: { top: 36, right: 20, bottom: 36, left: 56 },
      xAxis: {
        type: "category",
        data: trend.map(item => item.bucket)
      },
      yAxis: {
        type: "value"
      },
      series: [
        {
          name: "对外付款",
          type: "bar",
          stack: "amount",
          data: trend.map(item => Number(item.outbound_amount.toFixed(2))),
          itemStyle: { color: "#c26245" }
        },
        {
          name: "对内付款",
          type: "bar",
          stack: "amount",
          data: trend.map(item => Number(item.internal_amount.toFixed(2))),
          itemStyle: { color: "#4b6cb7" }
        },
        {
          name: "收款",
          type: "bar",
          stack: "amount",
          data: trend.map(item => Number(item.receipt_amount.toFixed(2))),
          itemStyle: { color: "#2f8f6b" }
        },
        {
          name: "合计",
          type: "line",
          smooth: true,
          data: trend.map(item => Number(item.total_amount.toFixed(2))),
          itemStyle: { color: "#2a241d" }
        }
      ]
    });
  }

  if (structureChartRef.value) {
    if (!structureChart) {
      structureChart = echarts.init(structureChartRef.value);
    }

    structureChart.setOption({
      tooltip: { trigger: "item" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["36%", "65%"],
          itemStyle: {
            borderRadius: 8,
            borderColor: "#fff",
            borderWidth: 2
          },
          label: {
            formatter: "{b}\n{d}%"
          },
          data: snapshot.value.charts.structure.map(item => ({
            name: item.biz_type_label,
            value: Number(item.amount.toFixed(2))
          }))
        }
      ]
    });
  }
};

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadSnapshot = async () => {
  loading.value = true;
  try {
    const result = await getFinanceSnapshot({
      period_type: filters.value.period_type,
      period: filters.value.period,
      project_id: filters.value.project_id,
      admin_userid: filters.value.admin_userid || undefined,
      biz_type: filters.value.biz_type,
      page: page.value,
      pageSize: pageSize.value
    });

    snapshot.value = result.data;
    total.value = result.data.pagination.total;
    await renderCharts();
  } finally {
    loading.value = false;
  }
};

const onQuery = async () => {
  page.value = 1;
  await loadSnapshot();
};

const onPeriodTypeChange = (val: FinanceSnapshotPeriodType) => {
  if (val === "year") {
    filters.value.period = String(new Date().getFullYear());
    return;
  }
  filters.value.period = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
};

const goDetail = (row: FinanceSnapshotDetail) => {
  if (row.link_path.startsWith("/")) {
    router.push(row.link_path);
  }
};

const onResize = () => {
  trendChart?.resize();
  structureChart?.resize();
};

watch(
  () => filters.value.period_type,
  val => {
    onPeriodTypeChange(val);
  }
);

onMounted(async () => {
  await Promise.all([loadProjects(), loadWecomUsers()]);
  await loadSnapshot();
  window.addEventListener("resize", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  trendChart?.dispose();
  structureChart?.dispose();
  trendChart = null;
  structureChart = null;
});
</script>

<template>
  <el-card shadow="never" :loading="loading" class="snapshot-card">
    <template #header>
      <div class="header">
        <div>
          <div class="title">财务快照看板（升级版）</div>
          <div class="sub">
            按时间/项目/办公室行政查看对外付款、对内付款、收款全景，并支持明细追踪与跳转
          </div>
        </div>
        <div class="header__ops">
          <el-button type="primary" @click="onQuery">刷新</el-button>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="时间维度">
        <el-select v-model="filters.period_type" style="width: 130px">
          <el-option label="按月" value="month" />
          <el-option label="按年" value="year" />
        </el-select>
      </el-form-item>
      <el-form-item label="时间">
        <el-date-picker
          v-if="filters.period_type === 'month'"
          v-model="filters.period"
          type="month"
          value-format="YYYY-MM"
          style="width: 160px"
        />
        <el-date-picker
          v-else
          v-model="filters.period"
          type="year"
          value-format="YYYY"
          style="width: 160px"
        />
      </el-form-item>
      <el-form-item label="项目">
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
      <el-form-item label="办公室行政">
        <el-select
          v-model="filters.admin_userid"
          clearable
          filterable
          style="width: 230px"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="业务类型">
        <el-select v-model="filters.biz_type" style="width: 140px">
          <el-option label="全部" value="all" />
          <el-option label="对外付款" value="outbound" />
          <el-option label="对内付款" value="internal" />
          <el-option label="收款" value="receipt" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="onQuery">查询</el-button>
    </el-form>

    <el-alert
      :title="`统计区间：${snapshot.filters.start_date} 至 ${snapshot.filters.end_date}（结束边界不含）`"
      type="info"
      :closable="false"
      class="mt-3"
    />

    <el-row :gutter="12" class="mt-3">
      <el-col :md="6" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">对外付款总额</div>
          <div class="kpi-value">
            ¥{{ amountFormatter(snapshot.summary.outbound.total_amount) }}
          </div>
          <div class="kpi-sub">
            完成 {{ snapshot.summary.outbound.count }} 笔，待处理
            {{ snapshot.summary.outbound.pending_count }} 笔
          </div>
        </el-card>
      </el-col>
      <el-col :md="6" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">对内付款总额</div>
          <div class="kpi-value">
            ¥{{ amountFormatter(snapshot.summary.internal.total_amount) }}
          </div>
          <div class="kpi-sub">
            完成 {{ snapshot.summary.internal.count }} 笔，待处理
            {{ snapshot.summary.internal.pending_count }} 笔
          </div>
        </el-card>
      </el-col>
      <el-col :md="6" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">收款总额</div>
          <div class="kpi-value">
            ¥{{ amountFormatter(snapshot.summary.receipt.total_amount) }}
          </div>
          <div class="kpi-sub">
            完成 {{ snapshot.summary.receipt.count }} 笔，待处理
            {{ snapshot.summary.receipt.pending_count }} 笔
          </div>
        </el-card>
      </el-col>
      <el-col :md="6" :xs="24">
        <el-card shadow="never">
          <div class="kpi-label">全口径资金总额</div>
          <div class="kpi-value">
            ¥{{ amountFormatter(snapshot.summary.total_amount) }}
          </div>
          <div class="kpi-sub">管理视角：对外 + 对内 + 收款</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="12" class="mt-3">
      <el-col :md="16" :xs="24">
        <el-card shadow="never">
          <template #header>趋势图（按时间维度）</template>
          <div ref="trendChartRef" class="trend-chart" />
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never">
          <template #header>结构图（业务占比）</template>
          <div ref="structureChartRef" class="structure-chart" />
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt-3">
      <template #header>
        <div class="detail-header">
          <span>明细追踪</span>
          <span class="detail-sub">点击单号可跳转对应业务页面</span>
        </div>
      </template>

      <el-table :data="snapshot.details" stripe>
        <el-table-column prop="biz_type_label" label="业务" width="100" />
        <el-table-column label="单号" min-width="170">
          <template #default="scope">
            <el-button link type="primary" @click="goDetail(scope.row)">{{
              scope.row.biz_no
            }}</el-button>
          </template>
        </el-table-column>
        <el-table-column label="项目" min-width="180">
          <template #default="scope">
            {{
              scope.row.project_name ||
              projectMap[scope.row.project_id] ||
              scope.row.project_id
            }}
          </template>
        </el-table-column>
        <el-table-column prop="admin_userid" label="办公室行政" width="150" />
        <el-table-column label="金额" width="130">
          <template #default="scope"
            >¥{{ amountFormatter(scope.row.amount) }}</template
          >
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope">{{
            toStatusLabel(scope.row.biz_type, scope.row.status)
          }}</template>
        </el-table-column>
        <el-table-column prop="occurred_at" label="业务时间" width="180" />
        <el-table-column
          prop="latest_trace_at"
          label="最近追踪时间"
          width="180"
        />
        <el-table-column prop="track_note" label="追踪信息" min-width="180" />
      </el-table>

      <el-pagination
        class="pager"
        background
        layout="prev, pager, next, total"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        @current-change="
          (val: number) => {
            page = val;
            loadSnapshot();
          }
        "
      />
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
  gap: 12px;
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
  color: #6e6458;
  font-size: 13px;
}

.kpi-value {
  margin-top: 8px;
  color: #2a241d;
  font-size: 23px;
  font-weight: 700;
}

.kpi-sub {
  margin-top: 6px;
  color: #6e6458;
  font-size: 12px;
}

.trend-chart {
  width: 100%;
  height: 360px;
}

.structure-chart {
  width: 100%;
  height: 360px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-sub {
  color: #6e6458;
  font-size: 12px;
}

.mt-3 {
  margin-top: 12px;
}

.pager {
  margin-top: 12px;
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
