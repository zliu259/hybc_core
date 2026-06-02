<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  deleteOperatorLog,
  listOperatorLogs,
  type OperatorLog
} from "@/api/log";
import { useProjectOptions } from "@/composables/useProjectOptions";

defineOptions({ name: "OperatorLogList" });

const router = useRouter();
const loading = ref(false);
const list = ref<OperatorLog[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const { projects, loadProjects } = useProjectOptions();
const filters = ref({
  project_id: undefined as number | undefined,
  shift: "",
  date_from: "",
  date_to: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listOperatorLogs({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      shift: filters.value.shift || undefined,
      date_from: filters.value.date_from || undefined,
      date_to: filters.value.date_to || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const remove = async (row: OperatorLog) => {
  await deleteOperatorLog(row.id);
  message("删除成功", { type: "success" });
  await loadData();
};

const shiftLabel = (shift: string) => {
  if (shift === "day") return "白班";
  if (shift === "night") return "夜班";
  return shift || "-";
};

const deviationLabel = (row: OperatorLog) => {
  const directionMap: Record<string, string> = {
    left: "左偏",
    right: "右偏",
    high: "高",
    low: "低"
  };
  const horizontalDirection =
    row.horizontal_deviation_direction || row.deviation_direction || "";
  const horizontalValue = row.horizontal_deviation_mm ?? row.deviation_value_mm;
  const parts = [
    horizontalDirection && typeof horizontalValue === "number"
      ? `${directionMap[horizontalDirection] || horizontalDirection}${horizontalValue}mm`
      : "",
    row.vertical_deviation_direction && typeof row.vertical_deviation_mm === "number"
      ? `${directionMap[row.vertical_deviation_direction] || row.vertical_deviation_direction}${row.vertical_deviation_mm}mm`
      : ""
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

onMounted(async () => {
  await Promise.all([loadData(), loadProjects()]);
});
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
        <span>操作员日志列表</span>
        <el-button
          type="primary"
          @click="router.push('/construction/operator-log/form')"
          >新建日志</el-button
        >
      </div>
    </template>
    <el-form inline>
      <el-form-item label="项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          placeholder="按时间排序选择项目"
          style="width: 320px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="班次">
        <el-select v-model="filters.shift" clearable style="width: 140px">
          <el-option label="白班" value="day" />
          <el-option label="夜班" value="night" />
        </el-select>
      </el-form-item>
      <el-form-item label="日期范围">
        <el-date-picker
          v-model="filters.date_from"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 140px"
        />
        <span style="margin: 0 8px">-</span>
        <el-date-picker
          v-model="filters.date_to"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 140px"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="project_id" label="项目ID" width="90" />
      <el-table-column prop="log_date" label="日期" width="120" />
      <el-table-column label="班次" width="90">
        <template #default="scope">{{ shiftLabel(scope.row.shift) }}</template>
      </el-table-column>
      <el-table-column
        prop="completed_pipe_count"
        label="当班下管"
        width="100"
      />
      <el-table-column
        prop="cumulative_pipe_count"
        label="累计下管"
        width="100"
      />
      <el-table-column prop="footage_m" label="本班顶进(m)" width="110" />
      <el-table-column
        prop="cumulative_footage_m"
        label="累计顶进(m)"
        width="110"
      />
      <el-table-column
        prop="cutter_current_text"
        label="刀盘电流"
        width="110"
        show-overflow-tooltip
      />
      <el-table-column
        prop="main_thrust_text"
        label="顶力"
        width="110"
        show-overflow-tooltip
      />
      <el-table-column label="偏差" width="130">
        <template #default="scope">{{ deviationLabel(scope.row) }}</template>
      </el-table-column>
      <el-table-column prop="operator_userid" label="填报人" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="danger" @click="remove(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>
</template>
