<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  createManagerLog,
  deleteManagerLog,
  listManagerLogs,
  type ManagerLog
} from "@/api/log";

defineOptions({ name: "ManagerLog" });

const loading = ref(false);
const list = ref<ManagerLog[]>([]);
const dialogVisible = ref(false);
const submitting = ref(false);
const filters = ref({
  project_id: undefined as number | undefined,
  date_from: "",
  date_to: ""
});

const form = ref({
  project_id: undefined as number | undefined,
  log_date: "",
  title: "",
  detail_html: "",
  risk_note: "",
  photo_keys: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listManagerLogs({
      project_id: filters.value.project_id,
      date_from: filters.value.date_from || undefined,
      date_to: filters.value.date_to || undefined,
      page: 1,
      pageSize: 200
    });
    list.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    project_id: undefined,
    log_date: "",
    title: "",
    detail_html: "",
    risk_note: "",
    photo_keys: ""
  };
  dialogVisible.value = true;
};

const submit = async () => {
  if (!form.value.project_id || !form.value.log_date) {
    message("请填写项目和日期", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    const photos = form.value.photo_keys
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean)
      .map(file_key => ({ file_key }));
    await createManagerLog({
      project_id: form.value.project_id,
      log_date: form.value.log_date,
      title: form.value.title || undefined,
      detail_html: form.value.detail_html || undefined,
      risk_note: form.value.risk_note || undefined,
      status: "submitted",
      photos
    });
    message("管理员日志创建成功", { type: "success" });
    dialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const remove = async (row: ManagerLog) => {
  await deleteManagerLog(row.id);
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
        <span>管理员日志</span>
        <el-button type="primary" @click="openCreate">新建日志</el-button>
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
      <el-table-column prop="project_id" label="项目ID" width="90" />
      <el-table-column prop="log_date" label="日期" width="120" />
      <el-table-column prop="title" label="标题" min-width="160" />
      <el-table-column prop="manager_userid" label="填报人" width="120" />
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

  <el-dialog v-model="dialogVisible" title="新建管理员日志" width="720px">
    <el-form label-width="110px">
      <el-form-item label="项目ID" required>
        <el-input-number v-model="form.project_id" :min="1" />
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker
          v-model="form.log_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>
      <el-form-item label="标题">
        <el-input v-model="form.title" />
      </el-form-item>
      <el-form-item label="日志正文(富文本)">
        <el-input
          v-model="form.detail_html"
          type="textarea"
          :rows="6"
          placeholder="可直接输入HTML"
        />
      </el-form-item>
      <el-form-item label="风险说明">
        <el-input v-model="form.risk_note" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="照片file_key列表">
        <el-input
          v-model="form.photo_keys"
          type="textarea"
          :rows="4"
          placeholder="每行一个file_key"
        />
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
