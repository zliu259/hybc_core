<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { getLogDashboard, triggerLogSummary } from "@/api/log";

defineOptions({ name: "ConstructionDashboard" });

const loading = ref(false);
const summaryLoading = ref(false);
const projectId = ref<number | undefined>(undefined);
const data = ref({
  operator_count: 0,
  manager_count: 0,
  completed_total: 0,
  footage_total: 0,
  trend: [] as Array<Record<string, unknown>>
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await getLogDashboard({ project_id: projectId.value });
    data.value = {
      operator_count: Number(result.data.operator_count ?? 0),
      manager_count: Number(result.data.manager_count ?? 0),
      completed_total: Number(result.data.completed_total ?? 0),
      footage_total: Number(result.data.footage_total ?? 0),
      trend: (result.data.trend as Array<Record<string, unknown>>) ?? []
    };
  } finally {
    loading.value = false;
  }
};

const trigger = async (report_type: "daily" | "weekly") => {
  summaryLoading.value = true;
  try {
    const result = await triggerLogSummary({
      report_type,
      project_id: projectId.value
    });
    message(`已触发${report_type}汇总任务: ${result.data.task_id}`, {
      type: "success"
    });
  } finally {
    summaryLoading.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <div v-loading="loading">
    <el-card shadow="never" style="margin-bottom: 16px; background: #fffaf2">
      <el-form inline>
        <el-form-item label="项目ID">
          <el-input-number v-model="projectId" :min="1" />
        </el-form-item>
        <el-button type="primary" @click="loadData">查询</el-button>
        <el-button :loading="summaryLoading" @click="trigger('daily')"
          >触发日报</el-button
        >
        <el-button :loading="summaryLoading" @click="trigger('weekly')"
          >触发周报</el-button
        >
      </el-form>
    </el-card>

    <el-row :gutter="16">
      <el-col :md="6" :xs="12">
        <el-card shadow="never" style="background: #fffaf2"
          >操作员日志数: {{ data.operator_count }}</el-card
        >
      </el-col>
      <el-col :md="6" :xs="12">
        <el-card shadow="never" style="background: #fffaf2"
          >管理员日志数: {{ data.manager_count }}</el-card
        >
      </el-col>
      <el-col :md="6" :xs="12">
        <el-card shadow="never" style="background: #fffaf2"
          >累计下管: {{ data.completed_total }}</el-card
        >
      </el-col>
      <el-col :md="6" :xs="12">
        <el-card shadow="never" style="background: #fffaf2"
          >累计进尺(m): {{ data.footage_total }}</el-card
        >
      </el-col>
    </el-row>

    <el-card
      shadow="never"
      header="近30日日志趋势"
      style="margin-top: 16px; background: #fffaf2"
    >
      <el-table :data="data.trend">
        <el-table-column prop="log_date" label="日期" width="120" />
        <el-table-column
          prop="completed_pipe_count"
          label="当日下管数量"
          width="140"
        />
        <el-table-column prop="footage_m" label="当日进尺(m)" width="120" />
      </el-table>
    </el-card>
  </div>
</template>
