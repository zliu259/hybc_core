<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getProgressAlerts } from "@/api/log";

defineOptions({ name: "ConstructionProgressAlert" });

const loading = ref(false);
const date = ref("");
const list = ref<Array<Record<string, unknown>>>([]);

const loadData = async () => {
  loading.value = true;
  try {
    const result = await getProgressAlerts({ date: date.value || undefined });
    list.value = result.data;
  } finally {
    loading.value = false;
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
        <span>进度预警视图</span>
        <div>
          <el-date-picker
            v-model="date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 160px; margin-right: 8px"
          />
          <el-button type="primary" @click="loadData">查询</el-button>
        </div>
      </div>
    </template>

    <el-table :data="list" :loading="loading">
      <el-table-column prop="project_id" label="项目ID" width="90" />
      <el-table-column prop="project_name" label="项目" min-width="140" />
      <el-table-column prop="today_footage" label="当日进尺" width="110" />
      <el-table-column prop="avg_7d" label="近7日均值" width="110" />
      <el-table-column label="偏离比" width="110">
        <template #default="scope">{{
          Number(scope.row.ratio || 0).toFixed(2)
        }}</template>
      </el-table-column>
      <el-table-column label="等级" width="100">
        <template #default="scope">
          <el-tag :type="scope.row.level === 'high' ? 'danger' : 'warning'">{{
            scope.row.level
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="message" label="说明" min-width="180" />
    </el-table>
  </el-card>
</template>
