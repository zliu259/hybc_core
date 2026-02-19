<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  deleteOperatorLog,
  listOperatorLogs,
  type OperatorLog
} from "@/api/log";

defineOptions({ name: "OperatorLogList" });

const router = useRouter();
const loading = ref(false);
const list = ref<OperatorLog[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
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
        <span>操作员日志列表</span>
        <el-button
          type="primary"
          @click="router.push('/construction/operator-log/form')"
          >新建日志</el-button
        >
      </div>
    </template>
    <el-form inline>
      <el-form-item label="项目ID">
        <el-input-number v-model="filters.project_id" :min="1" />
      </el-form-item>
      <el-form-item label="班次">
        <el-select v-model="filters.shift" clearable style="width: 140px">
          <el-option label="day" value="day" />
          <el-option label="night" value="night" />
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
      <el-table-column prop="shift" label="班次" width="90" />
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
      <el-table-column prop="footage_m" label="进尺(m)" width="100" />
      <el-table-column prop="operator_userid" label="填报人" width="120" />
      <el-table-column prop="status" label="状态" width="100" />
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
