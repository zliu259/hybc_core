<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  analyzeInventoryAlert,
  listInventoryAlerts,
  type InventoryRow
} from "@/api/warehouse";

defineOptions({ name: "WarehouseAlert" });

const loading = ref(false);
const rows = ref<InventoryRow[]>([]);
const analyzingId = ref<number | null>(null);

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listInventoryAlerts();
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const analyze = async (row: InventoryRow) => {
  analyzingId.value = row.id;
  try {
    const result = await analyzeInventoryAlert(row.id);
    message(`已触发分析任务: ${result.data.task_id}`, { type: "success" });
  } finally {
    analyzingId.value = null;
  }
};

onMounted(loadData);
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
        <span>库存预警中心</span>
        <el-button @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-table :data="rows" :loading="loading">
      <el-table-column prop="warehouse_name" label="仓库" min-width="140" />
      <el-table-column prop="type_name" label="资产类型" min-width="140" />
      <el-table-column prop="quantity" label="当前库存" width="110" />
      <el-table-column prop="threshold" label="阈值" width="90" />
      <el-table-column label="缺口" width="90">
        <template #default="scope">
          {{
            Number(scope.row.threshold || 0) - Number(scope.row.quantity || 0)
          }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            :loading="analyzingId === scope.row.id"
            @click="analyze(scope.row)"
          >
            AI分析
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
