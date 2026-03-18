<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  createSiteSurvey,
  deleteSiteSurvey,
  listSiteSurveys,
  type SiteSurvey
} from "@/api/survey";
import { useProjectOptions } from "@/composables/useProjectOptions";

defineOptions({ name: "SiteSurvey" });

const loading = ref(false);
const list = ref<SiteSurvey[]>([]);
const { projects, loadProjects } = useProjectOptions();
const dialogVisible = ref(false);
const submitting = ref(false);
const filters = ref({
  project_id: undefined as number | undefined,
  date_from: "",
  date_to: ""
});
const itemsText = ref("地表沉降:正常\n周边交通:正常");

const form = ref({
  project_id: undefined as number | undefined,
  survey_date: "",
  location: "",
  weather: "",
  summary: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listSiteSurveys({
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
    survey_date: "",
    location: "",
    weather: "",
    summary: ""
  };
  itemsText.value = "地表沉降:正常\n周边交通:正常";
  dialogVisible.value = true;
};

const submit = async () => {
  if (!form.value.project_id || !form.value.survey_date) {
    message("请填写项目和勘查日期", { type: "warning" });
    return;
  }
  const items = itemsText.value
    .split("\n")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [item_name, item_value] = item.split(":");
      return {
        item_name: item_name?.trim() || "未命名",
        item_value: item_value?.trim() || ""
      };
    });

  submitting.value = true;
  try {
    await createSiteSurvey({
      project_id: form.value.project_id,
      survey_date: form.value.survey_date,
      location: form.value.location || undefined,
      weather: form.value.weather || undefined,
      summary: form.value.summary || undefined,
      status: "submitted",
      items
    });
    message("勘查记录创建成功", { type: "success" });
    dialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const remove = async (row: SiteSurvey) => {
  await deleteSiteSurvey(row.id);
  message("删除成功", { type: "success" });
  await loadData();
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
        <span>现场勘查</span>
        <el-button type="primary" @click="openCreate">新建勘查</el-button>
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
      <el-table-column prop="survey_date" label="勘查日期" width="120" />
      <el-table-column prop="location" label="位置" min-width="140" />
      <el-table-column prop="weather" label="天气" width="100" />
      <el-table-column
        prop="summary"
        label="摘要"
        min-width="180"
        show-overflow-tooltip
      />
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
  </el-card>

  <el-dialog v-model="dialogVisible" title="新建现场勘查" width="720px">
    <el-form label-width="120px">
      <el-form-item label="项目" required>
        <el-select
          v-model="form.project_id"
          filterable
          placeholder="按时间排序选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="勘查日期" required>
        <el-date-picker
          v-model="form.survey_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>
      <el-form-item label="位置">
        <el-input v-model="form.location" />
      </el-form-item>
      <el-form-item label="天气">
        <el-input v-model="form.weather" style="width: 220px" />
      </el-form-item>
      <el-form-item label="摘要">
        <el-input v-model="form.summary" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="子表项(名称:值)">
        <el-input v-model="itemsText" type="textarea" :rows="4" />
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
