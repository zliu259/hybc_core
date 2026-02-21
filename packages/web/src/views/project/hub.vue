<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "ProjectHub" });

const router = useRouter();
const loading = ref(false);
const rows = ref<Project[]>([]);
const keyword = ref("");

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<string, { label: string; type: TagType; progress: number }> = {
  planning: { label: "规划中", type: "info", progress: 10 },
  preparing: { label: "筹备中", type: "warning", progress: 35 },
  active: { label: "施工中", type: "success", progress: 72 },
  completing: { label: "收尾中", type: "primary", progress: 90 },
  archived: { label: "已归档", type: "info", progress: 100 }
};

const filteredRows = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter(item => {
    const source = `${item.project_code} ${item.project_name}`.toLowerCase();
    return source.includes(q);
  });
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listProjects({ page: 1, pageSize: 200 });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const goWorkspace = (id: number) => {
  router.push(`/project/workspace/${id}`);
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2" v-loading="loading">
    <template #header>
      <div class="head">
        <div>
          <div class="head__title">项目选择大厅</div>
          <div class="head__sub">卡片化进入项目工作区，优先展示在建项目</div>
        </div>
        <el-input v-model="keyword" clearable placeholder="搜索项目编号/名称" style="width: 300px" />
      </div>
    </template>

    <el-row :gutter="16">
      <el-col v-for="item in filteredRows" :key="item.id" :xs="24" :sm="12" :md="8" :lg="6">
        <div class="project-card" @click="goWorkspace(item.id)">
          <div class="project-card__tag">
            <el-tag :type="statusMap[item.status]?.type || 'info'" size="small">
              {{ statusMap[item.status]?.label || item.status }}
            </el-tag>
          </div>
          <div class="project-card__title">{{ item.project_name }}</div>
          <div class="project-card__code">{{ item.project_code }}</div>
          <div class="project-card__progress">
            <el-progress
              type="circle"
              :percentage="statusMap[item.status]?.progress || 0"
              :width="88"
              :stroke-width="8"
            />
          </div>
          <div class="project-card__foot">负责人：{{ item.manager_userid || "未指定" }}</div>
        </div>
      </el-col>
    </el-row>
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

.project-card {
  position: relative;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: linear-gradient(180deg, #fffdf8 0%, #fff8ec 100%);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
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
