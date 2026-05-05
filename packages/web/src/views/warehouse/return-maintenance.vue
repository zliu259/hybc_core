<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listWarehouseAssetWorkOrders,
  reviewWarehouseAssetWorkOrder,
  type WarehouseAssetWorkOrder
} from "@/api/warehouse";

defineOptions({ name: "WarehouseReturnMaintenance" });

const loading = ref(false);
const rows = ref<WarehouseAssetWorkOrder[]>([]);

const openRows = computed(() =>
  rows.value.filter(
    item => item.status !== "completed" && item.status !== "cancelled"
  )
);

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listWarehouseAssetWorkOrders({
      source: "return_receipt"
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const passTask = async (row: WarehouseAssetWorkOrder) => {
  await reviewWarehouseAssetWorkOrder(row.id, {
    action: "approve",
    result_summary: "返库检查通过，设备允许重新进入可调度状态"
  });
  message("返库检查已通过", { type: "success" });
  await loadData();
};

const rejectTask = async (row: WarehouseAssetWorkOrder) => {
  await reviewWarehouseAssetWorkOrder(row.id, {
    action: "reject",
    result_summary: "返库检查未通过，需要继续维护或补充证据"
  });
  message("已退回返库任务", { type: "warning" });
  await loadData();
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="page">
    <template #header>
      <div class="page__head">
        <div>
          <div class="page__title">返库检查维护</div>
          <div class="page__sub">
            项目返库设备签收后自动进入检查队列，完成前阻塞再次出库
          </div>
        </div>
        <el-tag type="danger" size="large">待处理 {{ openRows.length }}</el-tag>
      </div>
    </template>

    <el-alert
      type="warning"
      show-icon
      :closable="false"
      title="返库设备必须先完成检查、照片和简报复核，未完成时出库 gate 会自动拦截。"
      class="return-alert"
    />

    <el-table :data="rows" border>
      <el-table-column prop="work_order_no" label="任务号" width="160" />
      <el-table-column prop="status" label="状态" width="130" />
      <el-table-column prop="tracked_asset_id" label="设备ID" width="100" />
      <el-table-column prop="stock_order_id" label="返库单ID" width="110" />
      <el-table-column prop="warehouse_id" label="签收仓库" width="110" />
      <el-table-column prop="assignee_userid" label="执行人" width="140" />
      <el-table-column
        prop="required_photo_count"
        label="照片要求"
        width="100"
      />
      <el-table-column
        prop="result_summary"
        label="检查简报"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column
        prop="remark"
        label="任务说明"
        min-width="260"
        show-overflow-tooltip
      />
      <el-table-column label="复核" width="160" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="success"
            :disabled="
              row.status !== 'submitted' && row.status !== 'in_progress'
            "
            @click="passTask(row)"
            >通过</el-button
          >
          <el-button
            link
            type="danger"
            :disabled="row.status !== 'submitted'"
            @click="rejectTask(row)"
            >退回</el-button
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

.return-alert {
  margin-bottom: 14px;
}
</style>
