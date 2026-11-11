<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { listWhMembers, getWhOverview } from "@/api/wh/settings";
import type { WarehouseOverview } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { DOC_TYPE_LABELS } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";

defineOptions({ name: "WhOverview" });

const router = useRouter();
const { busy, run } = useWhAction();
const { loadUserNames, userNameOf } = useWecomUserOptions();
const overview = ref<WarehouseOverview | null>(null);
const keeperCount = ref<number | null>(null);

const cards = computed(() => {
  const o = overview.value;
  if (!o) return [];
  return [
    {
      label: "待确认清单",
      value: o.kits_to_confirm,
      to: { path: "/wh/kit", query: { status: "submitted" } }
    },
    {
      label: "待确认任务",
      value: o.tasks_to_confirm,
      to: { path: "/wh/task", query: { status: "submitted" } }
    },
    {
      label: "待派工任务",
      value: o.tasks_unassigned,
      to: { path: "/wh/task", query: { status: "unassigned" } }
    },
    { label: "超期任务", value: o.tasks_overdue, to: { path: "/wh/task" } },
    {
      label: "待检设备",
      value: o.devices_pending_inspection,
      to: { path: "/wh/device", query: { state: "pending_inspection" } }
    },
    {
      label: "维修中设备",
      value: o.devices_repairing,
      to: { path: "/wh/device", query: { state: "repairing" } }
    },
    {
      label: "在项目设备",
      value: o.devices_on_project,
      to: { path: "/wh/device", query: { state: "on_project" } }
    },
    {
      label: "低库存物资",
      value: o.low_stock_count,
      to: { path: "/wh/material", query: { low_stock: "1" } }
    }
  ];
});

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { hour12: false });

onMounted(async () => {
  void loadUserNames();
  const [result, members] = await Promise.all([
    run(() => getWhOverview()),
    run(() => listWhMembers())
  ]);
  if (result) overview.value = result.data;
  if (members)
    keeperCount.value = members.data.filter(m => m.role === "keeper").length;
});
</script>

<template>
  <div v-loading="busy" class="wh-overview">
    <el-alert
      v-if="keeperCount === 0"
      title="还没有设置库管，请先到设置里添加"
      type="warning"
      show-icon
      :closable="false"
    />
    <div class="toolbar">
      <el-button @click="router.push('/wh/settings')">设置</el-button>
    </div>
    <div class="cards">
      <el-card
        v-for="card in cards"
        :key="card.label"
        shadow="hover"
        class="card"
        @click="router.push(card.to)"
      >
        <div class="card-value">{{ card.value }}</div>
        <div class="card-label">{{ card.label }}</div>
      </el-card>
    </div>
    <el-card shadow="never">
      <template #header>最近的库房单</template>
      <el-table
        :data="overview?.recent_docs ?? []"
        size="small"
        empty-text="还没有库房单"
      >
        <el-table-column prop="doc_no" label="单号" width="170" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">{{
            DOC_TYPE_LABELS[row.doc_type]
          }}</template>
        </el-table-column>
        <el-table-column label="项目" min-width="160">
          <template #default="{ row }">{{ row.project_name ?? "-" }}</template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{
            formatTime(row.occurred_at)
          }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="110">
          <template #default="{ row }">{{
            userNameOf(row.operator_userid)
          }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.wh-overview {
  display: grid;
  gap: 16px;
}
.toolbar {
  display: flex;
  justify-content: flex-end;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.card {
  cursor: pointer;
}
.card-value {
  font-size: 28px;
  font-weight: 600;
}
.card-label {
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}
</style>
