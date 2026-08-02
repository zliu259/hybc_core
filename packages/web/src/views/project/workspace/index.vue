<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStoreHook } from "@/store/modules/user";
import { getProjectById, type Project } from "@/api/project";
import ProjectWorkspaceProjectPanel from "./project-panel.vue";
import ProjectWorkspaceEquipmentPanel from "./equipment-panel.vue";
import ProjectWorkspaceFinancePanel from "./finance-panel.vue";
import ProjectWorkspaceFilePanel from "./file-panel.vue";
import WeComToolBindingPanel from "./components/wecom-tool-binding-panel.vue";

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
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

watch(
  [activeTab, isSuperAdmin],
  ([tab, allowed]) => {
    if (tab === "wecom" && !allowed) {
      activeTab.value = "project";
    }
  },
  { immediate: true }
);

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMeta: Record<
  string,
  { label: string; type: TagType; color: string }
> = {
  planning: { label: "规划中", type: "info", color: "#909399" },
  preparing: { label: "筹备中", type: "warning", color: "#e6a23c" },
  active: { label: "施工中", type: "success", color: "#67c23a" },
  completing: { label: "收尾中", type: "primary", color: "#409eff" },
  archived: { label: "已归档", type: "info", color: "#909399" }
};

const lifecycleStages = [
  { key: "planning", label: "规划" },
  { key: "preparing", label: "筹备" },
  { key: "active", label: "施工" },
  { key: "completing", label: "收尾" },
  { key: "archived", label: "归档" }
] as const;

const headerLoading = ref(false);
const project = ref<Project | null>(null);

const currentStageIndex = computed(() => {
  const status = project.value?.status;
  return status ? lifecycleStages.findIndex(item => item.key === status) : -1;
});

const startDateText = computed(() => {
  const source = project.value?.project_start_at || project.value?.start_date;
  return source ? source.slice(0, 10) : "未设置";
});

const loadProject = async () => {
  if (!Number.isFinite(projectId.value) || projectId.value <= 0) {
    project.value = null;
    return;
  }
  headerLoading.value = true;
  try {
    const result = await getProjectById(projectId.value);
    project.value = result.data;
  } catch {
    // 头卡拉取失败仅降级为「项目 ID: N」展示，不阻塞下方 tabs
    project.value = null;
  } finally {
    headerLoading.value = false;
  }
};

watch(projectId, () => {
  void loadProject();
});

onMounted(loadProject);
</script>

<template>
  <el-card v-loading="headerLoading" shadow="never" class="mb-3 head-card">
    <div class="head">
      <div class="head__main">
        <template v-if="project">
          <div class="head__title-row">
            <span class="head__name">{{ project.project_name }}</span>
            <span class="head__code">{{ project.project_code }}</span>
            <el-tag
              :type="statusMeta[project.status]?.type || 'info'"
              size="small"
            >
              {{ statusMeta[project.status]?.label || project.status }}
            </el-tag>
          </div>
          <div class="head__meta">
            <span>位置：{{ project.location_text || "未设置" }}</span>
            <span>负责人：{{ project.manager_userid || "未指定" }}</span>
            <span>开工日期：{{ startDateText }}</span>
          </div>
          <div class="stage-bar">
            <div
              v-for="(stage, index) in lifecycleStages"
              :key="stage.key"
              class="stage-bar__item"
            >
              <div
                class="stage-bar__seg"
                :class="{ 'stage-bar__seg--past': index < currentStageIndex }"
                :style="
                  index === currentStageIndex
                    ? { background: statusMeta[stage.key]?.color }
                    : undefined
                "
              />
              <div
                v-if="index === currentStageIndex"
                class="stage-bar__label"
                :style="{ color: statusMeta[stage.key]?.color }"
              >
                {{ stage.label }}
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="head__name">项目工作区</div>
          <div class="head__fallback">项目 ID: {{ projectId }}</div>
        </template>
      </div>
      <el-button @click="$router.push('/field/projects')">
        返回项目大厅
      </el-button>
    </div>
  </el-card>

  <el-tabs v-model="activeTab" type="border-card">
    <el-tab-pane label="项目动态与工作段" name="project">
      <ProjectWorkspaceProjectPanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane label="设备与材料" name="equipment">
      <ProjectWorkspaceEquipmentPanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane label="文件库" name="files">
      <ProjectWorkspaceFilePanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane v-if="isSuperAdmin" label="项目群绑定" name="wecom">
      <WeComToolBindingPanel :project-id="projectId" />
    </el-tab-pane>
    <el-tab-pane label="财务面板" name="finance">
      <ProjectWorkspaceFinancePanel
        :project-id="projectId"
        :mask-sensitive="isOperator"
      />
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
.head-card {
  background: linear-gradient(180deg, #fffdf7 0%, #fffaf2 100%);
  border-color: #e3d5b8;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.head__title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.head__name {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.head__code {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: #8c6a2f;
}

.head__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-top: 6px;
  font-size: 12px;
  color: #6e6458;
}

.head__fallback {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

/* 迷你生命周期阶段条：规划→筹备→施工→收尾→归档 */
.stage-bar {
  display: flex;
  gap: 4px;
  max-width: 420px;
  margin-top: 10px;
}

.stage-bar__item {
  flex: 1;
}

.stage-bar__seg {
  height: 5px;
  border-radius: 3px;
  background: #ece3d0;
}

.stage-bar__seg--past {
  background: #dcc99a;
}

.stage-bar__label {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1;
  text-align: center;
}
</style>
