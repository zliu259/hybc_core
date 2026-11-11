<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { listKits } from "@/api/wh/kit";
import type { ProjectKitRow, ProjectKitStatus } from "@/api/wh/kit-types";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { formatTime } from "../shared/ids";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import KitCreateDialog from "./components/KitCreateDialog.vue";
import { KIT_STATUS_LABELS, KIT_STATUS_TAG } from "./kit-view";

defineOptions({ name: "WhKit" });

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const { projects, loadProjects } = useProjectOptions();

const STATUSES = Object.keys(KIT_STATUS_LABELS) as ProjectKitStatus[];
const parseStatus = (value: unknown): ProjectKitStatus | "" =>
  STATUSES.includes(value as ProjectKitStatus)
    ? (value as ProjectKitStatus)
    : "";

const query = reactive({
  status: parseStatus(route.query.status),
  project_id: null as number | null,
  keyword: "",
  page: 1,
  pageSize: 20
});
const rows = ref<ProjectKitRow[]>([]);
const total = ref(0);
const createOpen = ref(false);

// 只有现场负责人身份（不是库管、不是经理）时，新建只能选自己负责的项目
const onlyProjectsOf = computed(() => {
  const roles = userStore.roles ?? [];
  if (caps.value?.is_keeper || roles.includes("manager")) return null;
  return userStore.username || null;
});

const load = async () => {
  const result = await run(() =>
    listKits({
      status: query.status || undefined,
      project_id: query.project_id ?? undefined,
      keyword: query.keyword.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize
    })
  );
  if (result) {
    rows.value = result.data;
    total.value = result.pagination.total;
  }
};

watch(
  () => [query.status, query.project_id, query.pageSize],
  () => {
    query.page = 1;
    void load();
  }
);
watch(
  () => route.query.status,
  value => {
    query.status = parseStatus(value);
  }
);

onMounted(async () => {
  void loadProjects(100).catch(error =>
    console.error("[warehouse] 读取项目失败", error)
  );
  await loadCaps();
  await load();
});
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="query.status">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane
        v-for="status in STATUSES"
        :key="status"
        :label="KIT_STATUS_LABELS[status]"
        :name="status"
      />
    </el-tabs>
    <div class="toolbar">
      <el-select
        v-model="query.project_id"
        clearable
        filterable
        placeholder="全部项目"
        style="width: 220px"
      >
        <el-option
          v-for="project in projects"
          :key="project.id"
          :label="project.project_name"
          :value="project.id"
        />
      </el-select>
      <el-input
        v-model="query.keyword"
        clearable
        placeholder="清单号、标题、项目"
        style="width: 220px"
        @keyup.enter="load"
        @clear="load"
      />
      <el-button @click="load">查询</el-button>
      <span class="spacer" />
      <el-button v-if="caps?.is_keeper" @click="router.push('/wh/kit-template')"
        >配套模板</el-button
      >
      <el-button
        v-if="caps?.can_create_kit"
        type="primary"
        @click="createOpen = true"
        >新建清单</el-button
      >
    </div>
    <el-table
      v-loading="busy"
      :data="rows"
      @row-click="(row: ProjectKitRow) => router.push(`/wh/kit/${row.id}`)"
    >
      <el-table-column prop="kit_no" label="清单号" width="170" />
      <el-table-column prop="project_name" label="项目" min-width="160" />
      <el-table-column prop="title" label="标题" min-width="160" />
      <el-table-column label="模板" width="120">
        <template #default="{ row }">{{ row.template_name ?? "-" }}</template>
      </el-table-column>
      <el-table-column prop="line_count" label="行数" width="70" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="KIT_STATUS_TAG[row.status]">{{
            KIT_STATUS_LABELS[row.status]
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="170">
        <template #default="{ row }">{{ formatTime(row.updated_at) }}</template>
      </el-table-column>
      <template #empty>没有清单</template>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
      />
    </div>
    <KitCreateDialog
      v-model="createOpen"
      :only-projects-of="onlyProjectsOf"
      @created="(id: number) => router.push(`/wh/kit/${id}`)"
    />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.spacer {
  flex: 1;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
