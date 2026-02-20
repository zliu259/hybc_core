<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStoreHook } from "@/store/modules/user";
import ProjectWorkspaceProjectPanel from "./project-panel.vue";
import ProjectWorkspaceEquipmentPanel from "./equipment-panel.vue";
import ProjectWorkspaceFinancePanel from "./finance-panel.vue";

defineOptions({
  name: "ProjectWorkspace"
});

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();

const projectId = computed(() => Number(route.params.id));
const activeTab = computed({
  get: () => String(route.query.tab || "project"),
  set: val => {
    router.replace({
      path: route.path,
      query: {
        ...route.query,
        tab: val
      }
    });
  }
});

const isOperator = computed(() => (userStore.roles ?? []).includes("operator"));
</script>

<template>
  <el-card shadow="never" class="mb-3">
    <div class="flex justify-between items-center">
      <div>
        <div class="text-base font-semibold">项目工作区</div>
        <div class="text-sm text-[var(--el-text-color-secondary)]">
          项目 ID: {{ projectId }}
        </div>
      </div>
      <el-button @click="$router.push(`/project/detail/${projectId}`)">
        打开旧版详情
      </el-button>
    </div>
  </el-card>

  <el-tabs v-model="activeTab" type="border-card">
    <el-tab-pane label="项目面板" name="project">
      <ProjectWorkspaceProjectPanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane label="设备面板" name="equipment">
      <ProjectWorkspaceEquipmentPanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane label="财务面板" name="finance">
      <ProjectWorkspaceFinancePanel
        :project-id="projectId"
        :mask-sensitive="isOperator"
      />
    </el-tab-pane>
  </el-tabs>
</template>
