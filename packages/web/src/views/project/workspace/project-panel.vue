<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { message } from "@/utils/message";
import {
  getProjectById,
  listProjectSections,
  updateProject,
  updateProjectStatus,
  type Project,
  type ProjectSection
} from "@/api/project";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const saving = ref(false);
const project = ref<Project | null>(null);
const sections = ref<ProjectSection[]>([]);
const form = ref({
  project_name: "",
  manager_userid: ""
});

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    const [detail, sectionData] = await Promise.all([
      getProjectById(props.projectId),
      listProjectSections(props.projectId)
    ]);
    project.value = detail.data;
    sections.value = sectionData.data;
    form.value.project_name = detail.data.project_name;
    form.value.manager_userid = detail.data.manager_userid || "";
  } finally {
    loading.value = false;
  }
};

const saveBase = async () => {
  if (!project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, {
      project_name: form.value.project_name,
      manager_userid: form.value.manager_userid || null
    });
    message("项目信息已保存", { type: "success" });
    await loadData();
  } finally {
    saving.value = false;
  }
};

const setStatus = async (status: string) => {
  if (!project.value) return;
  await updateProjectStatus(project.value.id, status);
  message("状态已更新", { type: "success" });
  await loadData();
};

watch(
  () => props.projectId,
  () => {
    void loadData();
  }
);

onMounted(loadData);
</script>

<template>
  <div v-loading="loading">
    <el-card shadow="never" header="项目信息">
      <el-form label-width="90px">
        <el-form-item label="项目编码">
          <el-input :model-value="project?.project_code" disabled />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="form.project_name" />
        </el-form-item>
        <el-form-item label="项目经理">
          <el-input v-model="form.manager_userid" />
        </el-form-item>
        <el-form-item label="项目状态">
          <el-space>
            <el-tag>{{ project?.status }}</el-tag>
            <el-button size="small" @click="setStatus('planning')"
              >planning</el-button
            >
            <el-button size="small" @click="setStatus('preparing')"
              >preparing</el-button
            >
            <el-button size="small" @click="setStatus('active')"
              >active</el-button
            >
            <el-button size="small" @click="setStatus('completing')"
              >completing</el-button
            >
            <el-button size="small" @click="setStatus('archived')"
              >archived</el-button
            >
          </el-space>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveBase"
            >保存</el-button
          >
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" header="标段列表" class="mt-3">
      <el-table :data="sections">
        <el-table-column prop="section_code" label="标段编码" width="140" />
        <el-table-column prop="section_name" label="标段名称" />
        <el-table-column prop="section_length" label="里程(m)" width="120" />
        <el-table-column prop="status" label="状态" width="120" />
      </el-table>
    </el-card>
  </div>
</template>
