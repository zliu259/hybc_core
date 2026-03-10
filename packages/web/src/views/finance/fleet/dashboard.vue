<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import echarts from "@/plugins/echarts";
import { listEntities, type Entity } from "@/api/entity";
import { getVehicleFuelOverview, type VehicleFuelOverviewPeriodType } from "@/api/dashboard";

defineOptions({ name: "FleetFuelDashboard" });

const loading = ref(false);
const entities = ref<Entity[]>([]);
const periodType = ref<VehicleFuelOverviewPeriodType>("month");
const period = ref(new Date().toISOString().slice(0, 7));
const entityId = ref<number | undefined>(undefined);

const summary = ref({
  vehicle_total: 0,
  active_vehicle_total: 0,
  company_owned_vehicle_total: 0,
  employee_owned_vehicle_total: 0,
  mileage_log_count: 0,
  mileage_km_total: 0,
  fuel_apply_count: 0,
  fuel_requested_amount_total: 0,
  fuel_processed_count: 0,
  fuel_rejected_count: 0,
  fuel_pending_count: 0,
  active_card_count: 0,
  active_card_balance_total: 0
});

const trend = ref<Array<{ bucket: string; apply_count: number; requested_amount_total: number }>>([]);
const topVehicles = ref<
  Array<{
    id: number;
    vehicle_uuid: string;
    current_plate_no: string;
    ownership_type: string;
    apply_count: number;
    requested_amount_total: number;
  }>
>([]);

const amountFormatter = (value: number) => {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const trendRef = ref<HTMLElement | null>(null);
let trendChart: ReturnType<typeof echarts.init> | null = null;

const statusText = computed(() => {
  return `待处理 ${summary.value.fuel_pending_count} / 已处理 ${summary.value.fuel_processed_count} / 拒绝 ${summary.value.fuel_rejected_count}`;
});

const renderChart = async () => {
  await nextTick();
  if (!trendRef.value) return;
  if (!trendChart) {
    trendChart = echarts.init(trendRef.value);
  }
  trendChart.setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["申请笔数", "申请额度"] },
    grid: { top: 36, right: 20, bottom: 30, left: 45 },
    xAxis: { type: "category", data: trend.value.map((item) => item.bucket) },
    yAxis: [{ type: "value", name: "笔数" }, { type: "value", name: "额度" }],
    series: [
      {
        name: "申请笔数",
        type: "bar",
        data: trend.value.map((item) => item.apply_count),
        itemStyle: { color: "#4b6cb7" }
      },
      {
        name: "申请额度",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        data: trend.value.map((item) => Number(item.requested_amount_total.toFixed(2))),
        itemStyle: { color: "#c26245" }
      }
    ]
  });
};

const onPeriodTypeChange = (val: VehicleFuelOverviewPeriodType) => {
  period.value =
    val === "year"
      ? String(new Date().getFullYear())
      : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [entityResult, overviewResult] = await Promise.all([
      listEntities({ status: "active" }),
      getVehicleFuelOverview({
        period_type: periodType.value,
        period: period.value,
        entity_id: entityId.value
      })
    ]);
    entities.value = entityResult.data;
    summary.value = overviewResult.data.summary;
    trend.value = overviewResult.data.charts.fuel_apply_trend;
    topVehicles.value = overviewResult.data.charts.top_vehicles;
    await renderChart();
  } finally {
    loading.value = false;
  }
};

const onResize = () => {
  trendChart?.resize();
};

onMounted(async () => {
  await loadData();
  window.addEventListener("resize", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  trendChart?.dispose();
  trendChart = null;
});
</script>

<template>
  <el-card shadow="never" :loading="loading" style="background: #fffaf2">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <div>
          <div style="font-size: 18px; font-weight: 700">车辆用油领导总览</div>
          <div style="font-size: 13px; color: #6e6458">全公司车辆与油卡额度申请监控</div>
        </div>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="时间维度">
        <el-select v-model="periodType" style="width: 120px" @change="onPeriodTypeChange">
          <el-option label="按月" value="month" />
          <el-option label="按年" value="year" />
        </el-select>
      </el-form-item>
      <el-form-item label="时间">
        <el-date-picker v-if="periodType === 'month'" v-model="period" type="month" value-format="YYYY-MM" style="width: 160px" />
        <el-date-picker v-else v-model="period" type="year" value-format="YYYY" style="width: 160px" />
      </el-form-item>
      <el-form-item label="公司实体">
        <el-select v-model="entityId" clearable filterable style="width: 220px">
          <el-option v-for="item in entities" :key="item.id" :label="item.entity_name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :md="6" :xs="24"><el-card shadow="never">车辆总数：{{ summary.vehicle_total }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">在用车辆：{{ summary.active_vehicle_total }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">员工私车：{{ summary.employee_owned_vehicle_total }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">本期里程总和：{{ amountFormatter(summary.mileage_km_total) }} km</el-card></el-col>
    </el-row>

    <el-row :gutter="12" style="margin-top: 12px">
      <el-col :md="6" :xs="24"><el-card shadow="never">申请总额：¥{{ amountFormatter(summary.fuel_requested_amount_total) }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">申请笔数：{{ summary.fuel_apply_count }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">处理状态：{{ statusText }}</el-card></el-col>
      <el-col :md="6" :xs="24"><el-card shadow="never">油卡余额总额：¥{{ amountFormatter(summary.active_card_balance_total) }}</el-card></el-col>
    </el-row>

    <el-card shadow="never" style="margin-top: 12px">
      <template #header>油卡申请趋势</template>
      <div ref="trendRef" style="width: 100%; height: 320px" />
    </el-card>

    <el-card shadow="never" style="margin-top: 12px">
      <template #header>车辆用油排名（Top10）</template>
      <el-table :data="topVehicles" stripe>
        <el-table-column prop="current_plate_no" label="车牌" width="120" />
        <el-table-column prop="vehicle_uuid" label="车辆UUID" min-width="220" />
        <el-table-column prop="ownership_type" label="归属" width="120" />
        <el-table-column prop="apply_count" label="申请笔数" width="110" />
        <el-table-column label="申请总额" width="130">
          <template #default="scope">¥{{ amountFormatter(scope.row.requested_amount_total) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </el-card>
</template>
