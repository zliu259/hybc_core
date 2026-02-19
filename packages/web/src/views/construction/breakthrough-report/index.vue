<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  createBreakthroughReport,
  deleteBreakthroughReport,
  listBreakthroughReports,
  type BreakthroughReport
} from "@/api/survey";

defineOptions({ name: "BreakthroughReport" });

const loading = ref(false);
const list = ref<BreakthroughReport[]>([]);
const dialogVisible = ref(false);
const submitting = ref(false);
const filters = ref({
  project_id: undefined as number | undefined,
  date_from: "",
  date_to: ""
});

const form = ref({
  project_id: undefined as number | undefined,
  section_id: undefined as number | undefined,
  report_date: "",
  breakthrough_m: undefined as number | undefined,
  summary: "",
  detail: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listBreakthroughReports({
      project_id: filters.value.project_id,
      date_from: filters.value.date_from || undefined,
      date_to: filters.value.date_to || undefined
    });
    list.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    project_id: undefined,
    section_id: undefined,
    report_date: "",
    breakthrough_m: undefined,
    summary: "",
    detail: ""
  };
  dialogVisible.value = true;
};

const submit = async () => {
  if (!form.value.project_id || !form.value.report_date) {
    message("请填写项目和报告日期", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    await createBreakthroughReport({
      project_id: form.value.project_id,
      section_id: form.value.section_id,
      report_date: form.value.report_date,
      breakthrough_m: form.value.breakthrough_m,
      summary: form.value.summary || undefined,
      detail: form.value.detail || undefined,
      status: "submitted"
    });
    message("贯通报告创建成功", { type: "success" });
    dialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const remove = async (row: BreakthroughReport) => {
  await deleteBreakthroughReport(row.id);
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
        <span>贯通报告</span>
        <el-button type="primary" @click="openCreate">新建报告</el-button>
      </div>
    </template>
    <el-form inline>
      <el-form-item label="项目ID">
        <el-input-number v-model="filters.project_id" :min="1" />
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
      <el-table-column prop="report_no" label="报告编号" width="170" />
      <el-table-column prop="project_id" label="项目ID" width="90" />
      <el-table-column prop="report_date" label="报告日期" width="120" />
      <el-table-column prop="breakthrough_m" label="贯通里程(m)" width="120" />
      <el-table-column
        prop="summary"
        label="摘要"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="danger" @click="remove(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" title="新建贯通报告" width="700px">
    <el-form label-width="110px">
      <el-form-item label="项目ID" required>
        <el-input-number v-model="form.project_id" :min="1" />
      </el-form-item>
      <el-form-item label="标段ID">
        <el-input-number v-model="form.section_id" :min="1" />
      </el-form-item>
      <el-form-item label="报告日期" required>
        <el-date-picker
          v-model="form.report_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>
      <el-form-item label="贯通里程(m)">
        <el-input-number
          v-model="form.breakthrough_m"
          :min="0"
          :precision="2"
        />
      </el-form-item>
      <el-form-item label="摘要">
        <el-input v-model="form.summary" />
      </el-form-item>
      <el-form-item label="详情">
        <el-input v-model="form.detail" type="textarea" :rows="4" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit"
        >提交</el-button
      >
    </template>
  </el-dialog>
</template>
