<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { statusLabel } from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";

defineOptions({
  name: "ProjectWorkspaceEntry"
});

const router = useRouter();
const loading = ref(false);
const rows = ref<Project[]>([]);

const load = async () => {
  loading.value = true;
  try {
    const res = await listProjects({ page: 1, pageSize: 500 });
    rows.value = res.data;
  } finally {
    loading.value = false;
  }
};

const openWorkspace = (id: number, tab = "project") => {
  router.push(`/field/project/${id}?tab=${tab}`);
};

onMounted(load);
</script>

<template>
  <el-card shadow="never" header="项目工作区入口">
    <el-alert
      title="选择项目后进入项目化视图（项目/设备/财务）"
      type="info"
      :closable="false"
      show-icon
    />
    <el-table :data="rows" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="project_code" label="项目编号" width="180" />
      <el-table-column prop="project_name" label="项目名称" min-width="220" />
      <el-table-column label="状态" width="120">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="进入" width="240" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="openWorkspace(scope.row.id, 'project')"
          >
            项目面板
          </el-button>
          <el-button
            link
            type="primary"
            @click="openWorkspace(scope.row.id, 'equipment')"
          >
            设备面板
          </el-button>
          <el-button
            link
            type="primary"
            @click="openWorkspace(scope.row.id, 'finance')"
          >
            财务面板
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
