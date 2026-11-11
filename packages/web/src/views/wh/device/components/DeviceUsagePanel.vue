<script setup lang="ts">
import { computed } from "vue";

import type { DeviceUsageRecord, TaskRow } from "@/api/wh/types";
import { formatTime } from "../../shared/ids";
import { buildRepairGroups } from "../usage-view";

const props = defineProps<{
  records: DeviceUsageRecord[];
  totalMeters: number;
  repairs: TaskRow[];
}>();
const groups = computed(() => buildRepairGroups(props.repairs));
</script>

<template>
  <div class="usage">
    <div class="section-title">
      使用记录（累计顶进 {{ props.totalMeters }} 米）
    </div>
    <el-table :data="props.records" size="small" empty-text="还没有返库记录">
      <el-table-column prop="project_name" label="项目" min-width="160" />
      <el-table-column label="返库时间" width="170">
        <template #default="{ row }">{{
          formatTime(row.returned_at)
        }}</template>
      </el-table-column>
      <el-table-column label="顶进距离(米)" width="120">
        <template #default="{ row }">{{ row.usage_meters ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="土质" width="120">
        <template #default="{ row }">{{ row.soil_type ?? "-" }}</template>
      </el-table-column>
    </el-table>
    <div class="section-title">维修记录</div>
    <el-empty
      v-if="groups.length === 0"
      description="还没有完成的维修"
      :image-size="60"
    />
    <div v-for="group in groups" :key="group.system" class="group">
      <div class="group-title">{{ group.label }}</div>
      <div
        v-for="entry in group.entries"
        :key="entry.task_no + group.system"
        class="entry"
      >
        <span class="time">{{ formatTime(entry.done_at) }}</span
        >{{ entry.note }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.section-title {
  font-weight: 600;
  margin: 12px 0 8px;
}
.group {
  margin-bottom: 8px;
}
.group-title {
  font-weight: 500;
}
.entry {
  font-size: 13px;
  padding-left: 12px;
}
.time {
  color: var(--el-text-color-secondary);
  margin-right: 8px;
}
</style>
