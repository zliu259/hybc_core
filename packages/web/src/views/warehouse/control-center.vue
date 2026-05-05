<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listInventoryAlerts,
  listStockOrders,
  listWarehouseAssetWorkOrders,
  type InventoryRow,
  type StockOrder,
  type WarehouseAssetWorkOrder
} from "@/api/warehouse";

defineOptions({ name: "WarehouseControlCenter" });

const router = useRouter();
const loading = ref(false);
const tasks = ref<WarehouseAssetWorkOrder[]>([]);
const alerts = ref<InventoryRow[]>([]);
const stockOrders = ref<StockOrder[]>([]);

const openStatuses = new Set([
  "draft",
  "pending_assignment",
  "assigned",
  "pending_approval",
  "approved",
  "in_progress",
  "submitted",
  "rejected"
]);

const metrics = computed(() => {
  const openTasks = tasks.value.filter(item => openStatuses.has(item.status));
  return {
    open: openTasks.length,
    returnTasks: openTasks.filter(item => item.source === "return_receipt")
      .length,
    urgent: openTasks.filter(item => item.priority === "urgent").length,
    submitted: openTasks.filter(item => item.status === "submitted").length,
    alerts: alerts.value.length,
    approvedOrders: stockOrders.value.filter(item => item.status === "approved")
      .length
  };
});

const statusText: Record<string, string> = {
  draft: "草稿",
  pending_assignment: "待派工",
  assigned: "已派工",
  pending_approval: "审批中",
  approved: "已批准",
  in_progress: "执行中",
  submitted: "待复核",
  completed: "已完成",
  rejected: "已退回",
  cancelled: "已取消"
};

const priorityText: Record<string, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急"
};

const loadData = async () => {
  loading.value = true;
  try {
    const [taskRes, alertRes, orderRes] = await Promise.all([
      listWarehouseAssetWorkOrders(),
      listInventoryAlerts(),
      listStockOrders({ status: "approved" })
    ]);
    tasks.value = taskRes.data;
    alerts.value = alertRes.data;
    stockOrders.value = orderRes.data;
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="page">
    <template #header>
      <div class="page__head">
        <div>
          <div class="page__title">库房总控台</div>
          <div class="page__sub">
            库房负责人从任务、返库、库存告警和待执行出入库统一调度
          </div>
        </div>
        <el-button
          type="primary"
          @click="router.push('/warehouse-assets/tasks')"
          >进入任务调度</el-button
        >
      </div>
    </template>

    <div class="metric-grid">
      <div class="metric">
        <span>开放任务</span><strong>{{ metrics.open }}</strong>
      </div>
      <div class="metric">
        <span>返库待检</span><strong>{{ metrics.returnTasks }}</strong>
      </div>
      <div class="metric">
        <span>紧急任务</span><strong>{{ metrics.urgent }}</strong>
      </div>
      <div class="metric">
        <span>待复核</span><strong>{{ metrics.submitted }}</strong>
      </div>
      <div class="metric">
        <span>库存告警</span><strong>{{ metrics.alerts }}</strong>
      </div>
      <div class="metric">
        <span>待执行单</span><strong>{{ metrics.approvedOrders }}</strong>
      </div>
    </div>

    <div class="section-title">当前任务队列</div>
    <el-table :data="tasks.slice(0, 12)" border>
      <el-table-column prop="work_order_no" label="任务号" width="160" />
      <el-table-column prop="work_order_type" label="类型" width="110" />
      <el-table-column label="状态" width="120">
        <template #default="{ row }">{{
          statusText[row.status] || row.status
        }}</template>
      </el-table-column>
      <el-table-column label="优先级" width="100">
        <template #default="{ row }">{{
          priorityText[row.priority] || row.priority
        }}</template>
      </el-table-column>
      <el-table-column prop="assignee_userid" label="执行人" width="140" />
      <el-table-column
        prop="remark"
        label="任务说明"
        min-width="260"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default>
          <el-button
            link
            type="primary"
            @click="router.push('/warehouse-assets/tasks')"
            >处理</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.page {
  background: #fffaf2;
}

.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page__title {
  font-size: 20px;
  font-weight: 700;
  color: #2a241d;
}

.page__sub {
  margin-top: 4px;
  color: #6e6458;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.metric {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 74px;
  padding: 14px;
  border: 1px solid #d9ceb9;
  border-radius: 8px;
  background: #fff;
}

.metric span {
  color: #6e6458;
}

.metric strong {
  font-size: 28px;
  color: #2f6c5f;
}

.section-title {
  margin: 8px 0 10px;
  font-weight: 700;
  color: #2a241d;
}
</style>
