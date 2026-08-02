<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listProjects, type Project } from "@/api/project";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({ name: "ProjectHub" });

const router = useRouter();
const userStore = useUserStoreHook();
const loading = ref(false);
const rows = ref<Project[]>([]);
const page = ref(1);
const pageSize = ref(24);
const total = ref(0);
const filters = ref({
  keyword: "",
  status: "",
  location: ""
});

const statusOptions = [
  { value: "planning", label: "规划中" },
  { value: "preparing", label: "筹备中" },
  { value: "active", label: "施工中" },
  { value: "completing", label: "收尾中" },
  { value: "archived", label: "已归档" }
];

const statusChips = [{ value: "", label: "全部" }, ...statusOptions];

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<string, { label: string; type: TagType }> = {
  planning: { label: "规划中", type: "info" },
  preparing: { label: "筹备中", type: "warning" },
  active: { label: "施工中", type: "success" },
  completing: { label: "收尾中", type: "primary" },
  archived: { label: "已归档", type: "info" }
};

const statusColor: Record<string, string> = {
  planning: "#909399",
  preparing: "#e6a23c",
  active: "#67c23a",
  completing: "#409eff",
  archived: "#c0c4cc"
};

const statusColorLight: Record<string, string> = {
  planning: "#dedfe0",
  preparing: "#f8e3c5",
  active: "#d5edc8",
  completing: "#c6e2ff",
  archived: "#e4e7ed"
};

const lifecycleStages = [
  { key: "planning", label: "规划" },
  { key: "preparing", label: "筹备" },
  { key: "active", label: "施工" },
  { key: "completing", label: "收尾" },
  { key: "archived", label: "归档" }
];

const stageIndexOf = (status: string): number =>
  lifecycleStages.findIndex(stage => stage.key === status);

const cardStyle = (status: string) => ({
  "--status-color": statusColor[status] || "#909399",
  "--status-color-light": statusColorLight[status] || "#dedfe0"
});

const statusRank: Record<string, number> = {
  active: 1,
  preparing: 2,
  planning: 3,
  completing: 4,
  archived: 5
};

const projectDisplayTime = (item: Project): number => {
  const source =
    item.project_start_at || item.start_date || item.created_at || "";
  const time = Date.parse(source);
  return Number.isNaN(time) ? 0 : time;
};

const projectDisplayDate = (item: Project): string => {
  const source = item.project_start_at || item.start_date || item.created_at;
  return source ? source.slice(0, 10) : "未设置";
};

const sortedRows = computed(() => {
  return [...rows.value].sort((a, b) => {
    const statusDiff =
      (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    const timeDiff = projectDisplayTime(b) - projectDisplayTime(a);
    if (timeDiff !== 0) return timeDiff;
    return b.id - a.id;
  });
});

const canCreateProject = computed(() => {
  const roles = userStore.roles || [];
  return (
    roles.includes("super_admin") ||
    roles.includes("manager") ||
    roles.includes("site_manager")
  );
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listProjects({
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.value.keyword || undefined,
      status: filters.value.status || undefined,
      location: filters.value.location || undefined
    });
    rows.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const onSearch = async () => {
  page.value = 1;
  await loadData();
};

const onStatusChip = async (value: string) => {
  filters.value.status = value;
  await onSearch();
};

const onReset = async () => {
  filters.value = { keyword: "", status: "", location: "" };
  page.value = 1;
  await loadData();
};

const onPageChange = async (value: number) => {
  page.value = value;
  await loadData();
};

const onSizeChange = async (value: number) => {
  pageSize.value = value;
  page.value = 1;
  await loadData();
};

const goWorkspace = (id: number) => {
  router.push(`/field/project/${id}`);
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" style="background: #fffaf2">
    <template #header>
      <div class="head">
        <div>
          <div class="head__title">项目选择大厅</div>
          <div class="head__sub">卡片化进入项目工作区，优先展示在建项目</div>
        </div>
        <div class="head__actions">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="搜索项目编号/名称"
            style="width: 220px"
          />
          <el-input
            v-model="filters.location"
            clearable
            placeholder="按位置筛选"
            style="width: 180px"
          />
          <el-button type="primary" @click="onSearch">筛选</el-button>
          <el-button @click="onReset">重置</el-button>
          <el-button
            v-if="canCreateProject"
            type="primary"
            @click.stop="router.push('/field/project/create')"
          >
            + 创建项目
          </el-button>
        </div>
      </div>
      <div class="status-chips">
        <button
          v-for="chip in statusChips"
          :key="chip.value"
          type="button"
          class="status-chip"
          :class="{ 'is-active': filters.status === chip.value }"
          @click="onStatusChip(chip.value)"
        >
          {{ chip.label }}
        </button>
      </div>
    </template>

    <el-row :gutter="16">
      <el-col
        v-for="item in sortedRows"
        :key="item.id"
        :xs="24"
        :sm="12"
        :md="8"
        :lg="6"
      >
        <div
          class="project-card"
          :style="cardStyle(item.status)"
          @click="goWorkspace(item.id)"
        >
          <div class="project-card__top">
            <el-tag :type="statusMap[item.status]?.type || 'info'" size="small">
              {{ statusMap[item.status]?.label || item.status }}
            </el-tag>
            <span class="project-card__date">{{
              projectDisplayDate(item)
            }}</span>
          </div>
          <div class="project-card__title">{{ item.project_name }}</div>
          <div class="project-card__code">{{ item.project_code }}</div>
          <div class="project-card__stages">
            <div class="project-card__stage-bar">
              <span
                v-for="(stage, index) in lifecycleStages"
                :key="stage.key"
                class="project-card__stage-seg"
                :class="{
                  'is-past': index < stageIndexOf(item.status),
                  'is-current': index === stageIndexOf(item.status)
                }"
              />
            </div>
            <div class="project-card__stage-labels">
              <span
                v-for="(stage, index) in lifecycleStages"
                :key="stage.key"
                class="project-card__stage-label"
              >
                {{ index === stageIndexOf(item.status) ? stage.label : "" }}
              </span>
            </div>
          </div>
          <div class="project-card__meta">
            <span class="project-card__meta-label">位置</span>
            <span class="project-card__meta-value">{{
              item.location_text || "未设置"
            }}</span>
          </div>
          <div class="project-card__meta">
            <span class="project-card__meta-label">负责人</span>
            <span class="project-card__meta-value">{{
              item.manager_userid || "未指定"
            }}</span>
          </div>
          <div class="project-card__briefing">
            项目交底：{{ item.project_briefing || "暂无" }}
          </div>
          <div class="project-card__enter">进入工作区 →</div>
        </div>
      </el-col>
    </el-row>

    <el-pagination
      style="margin-top: 8px; justify-content: flex-end"
      background
      layout="sizes, prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="[12, 24, 48, 96]"
      :total="total"
      @current-change="onPageChange"
      @size-change="onSizeChange"
    />
  </el-card>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.head__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.head__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.status-chip {
  padding: 4px 14px;
  font-size: 12px;
  color: #6b4f2a;
  cursor: pointer;
  background: #fffdf7;
  border: 1px solid #e3d5b8;
  border-radius: 999px;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.status-chip:hover {
  border-color: #c9a35c;
  color: #8c6a2f;
}

.status-chip.is-active {
  background: #c9a35c;
  border-color: #c9a35c;
  color: #fff;
}

@media (max-width: 768px) {
  .head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .head__actions {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }
}

.project-card {
  position: relative;
  margin-bottom: 16px;
  padding: 14px 16px 30px;
  overflow: hidden;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff8ec 100%);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.project-card::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--status-color);
  border-radius: 10px 0 0 10px;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 20px rgb(42 36 29 / 12%);
}

.project-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.project-card__date {
  font-size: 11px;
  color: #6e6458;
}

.project-card__title {
  margin-top: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #2a241d;
}

.project-card__code {
  margin-top: 4px;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: #8c6a2f;
}

.project-card__stages {
  margin: 12px 0 10px;
}

.project-card__stage-bar {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  min-height: 8px;
}

.project-card__stage-seg {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #ece3d0;
  transition: background 0.2s ease;
}

.project-card__stage-seg.is-past {
  background: var(--status-color-light);
}

.project-card__stage-seg.is-current {
  height: 8px;
  background: var(--status-color);
}

.project-card__stage-labels {
  display: flex;
  gap: 3px;
  margin-top: 3px;
}

.project-card__stage-label {
  flex: 1;
  min-height: 13px;
  font-size: 11px;
  line-height: 1.2;
  color: var(--status-color);
  text-align: center;
}

.project-card__meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 4px;
  font-size: 12px;
  color: #3f3527;
}

.project-card__meta-label {
  flex: none;
  font-size: 11px;
  color: #6e6458;
}

.project-card__meta-value {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.project-card__briefing {
  margin-top: 8px;
  min-height: 34px;
  font-size: 12px;
  color: #4e453b;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-card__enter {
  position: absolute;
  right: 14px;
  bottom: 9px;
  font-size: 12px;
  font-weight: 600;
  color: #c9a35c;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.project-card:hover .project-card__enter {
  opacity: 1;
}
</style>
