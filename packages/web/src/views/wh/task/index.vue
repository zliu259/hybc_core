<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { listTasks } from "@/api/wh/task";
import type { TaskRow } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { TASK_KIND_LABELS, taskStatusLabel } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import TaskDetailDrawer from "./components/TaskDetailDrawer.vue";
import TaskFormDialog from "./components/TaskFormDialog.vue";
import {
  beijingToday,
  isOverdue,
  parseTaskFilter,
  photoProgress,
  TASK_FILTERS,
  taskFilterQuery,
  type TaskFilter
} from "./task-view";

defineOptions({ name: "Whtask" });

const route = useRoute();
const { caps, load: loadCaps } = useWhCapabilities();
const { userNameOf, loadUserNames } = useWecomUserOptions();
const { busy, run } = useWhAction();

const initialFilter = parseTaskFilter(route.query.status);
const query = reactive({
  // 从总览卡片跳来时看全部；否则先看自己的
  scope: (initialFilter ? "all" : "mine") as "mine" | "all",
  filter: initialFilter as TaskFilter,
  page: 1,
  pageSize: 20
});
const rows = ref<TaskRow[]>([]);
const total = ref(0);
const today = ref(beijingToday());
const formOpen = ref(false);
const detailOpen = ref(false);
const detailId = ref<number | null>(null);

const load = async () => {
  today.value = beijingToday();
  const result = await run(() =>
    listTasks({
      scope: query.scope,
      ...taskFilterQuery(query.filter),
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
  () => [query.scope, query.filter, query.pageSize],
  () => {
    query.page = 1;
    void load();
  }
);

// 已经在本页时再点带 ?status= 的链接，路由只改参数不重建页面
watch(
  () => route.query.status,
  value => {
    const filter = parseTaskFilter(value);
    if (!filter) return;
    query.scope = "all";
    query.filter = filter;
  }
);

const open = (id: number) => {
  detailId.value = id;
  detailOpen.value = true;
};

const onCreated = (id: number) => {
  open(id);
  void load();
};

onMounted(async () => {
  void loadUserNames();
  await loadCaps();
  if (!initialFilter && caps.value?.is_keeper) query.scope = "all";
  else void load();
});
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="query.scope">
      <el-tab-pane label="我的" name="mine" />
      <el-tab-pane label="全部" name="all" />
    </el-tabs>
    <div class="toolbar">
      <el-select
        v-model="query.filter"
        clearable
        placeholder="全部状态"
        style="width: 160px"
      >
        <el-option
          v-for="item in TASK_FILTERS"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-button @click="load">刷新</el-button>
      <span class="spacer" />
      <el-button v-if="caps?.is_keeper" type="primary" @click="formOpen = true"
        >新建任务</el-button
      >
    </div>
    <el-table
      v-loading="busy"
      :data="rows"
      row-key="id"
      style="width: 100%"
      @row-click="(row: TaskRow) => open(row.id)"
    >
      <el-table-column prop="task_no" label="任务号" width="170" />
      <el-table-column label="类型" width="70">
        <template #default="{ row }">{{ TASK_KIND_LABELS[row.kind] }}</template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="200" />
      <el-table-column label="设备" min-width="180">
        <template #default="{ row }">{{
          row.device_id ? `${row.device_code} ${row.device_name}` : "-"
        }}</template>
      </el-table-column>
      <el-table-column label="执行人" width="100">
        <template #default="{ row }">{{
          userNameOf(row.assignee_userid)
        }}</template>
      </el-table-column>
      <el-table-column label="期限" width="110">
        <template #default="{ row }">
          <span :class="{ overdue: isOverdue(row, today) }">{{
            row.due_date ?? "-"
          }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">{{ taskStatusLabel(row) }}</template>
      </el-table-column>
      <el-table-column label="照片" width="70">
        <template #default="{ row }">{{ photoProgress(row) }}</template>
      </el-table-column>
      <template #empty>
        {{ query.scope === "mine" ? "没有派给你的任务" : "没有任务" }}
      </template>
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
    <TaskFormDialog v-model="formOpen" @created="onCreated" />
    <TaskDetailDrawer
      v-model="detailOpen"
      :task-id="detailId"
      :is-keeper="Boolean(caps?.is_keeper)"
      @changed="load"
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

.overdue {
  font-weight: 600;
  color: var(--el-color-danger);
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
