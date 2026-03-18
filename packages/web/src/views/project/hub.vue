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

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<
  string,
  { label: string; type: TagType; progress: number }
> = {
  planning: { label: "规划中", type: "info", progress: 10 },
  preparing: { label: "筹备中", type: "warning", progress: 35 },
  active: { label: "施工中", type: "success", progress: 72 },
  completing: { label: "收尾中", type: "primary", progress: 90 },
  archived: { label: "已归档", type: "info", progress: 100 }
};

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
          <el-select
            v-model="filters.status"
            clearable
            placeholder="状态筛选"
            style="width: 140px"
          >
            <el-option
              v-for="item in statusOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
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
        <div class="project-card" @click="goWorkspace(item.id)">
          <div class="project-card__tag">
            <el-tag :type="statusMap[item.status]?.type || 'info'" size="small">
              {{ statusMap[item.status]?.label || item.status }}
            </el-tag>
          </div>
          <div class="project-card__title">{{ item.project_name }}</div>
          <div class="project-card__code">{{ item.project_code }}</div>
          <div class="project-card__meta">
            开工时间：{{ projectDisplayDate(item) }}
          </div>
          <div class="project-card__meta">
            位置：{{ item.location_text || "未设置" }}
          </div>
          <div class="project-card__briefing">
            项目交底：{{ item.project_briefing || "暂无" }}
          </div>
          <div class="project-card__progress">
            <el-progress
              type="circle"
              :percentage="statusMap[item.status]?.progress || 0"
              :width="88"
              :stroke-width="8"
            />
          </div>
          <div class="project-card__foot">
            负责人：{{ item.manager_userid || "未指定" }}
          </div>
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
  padding: 16px;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff8ec 100%);
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 20px rgb(42 36 29 / 12%);
}

.project-card__tag {
  display: flex;
  justify-content: flex-end;
}

.project-card__title {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 600;
  color: #2a241d;
}

.project-card__code {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.project-card__meta {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
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

.project-card__progress {
  display: flex;
  justify-content: center;
  margin: 14px 0 10px;
}

.project-card__foot {
  font-size: 12px;
  color: #6e6458;
}
</style>
