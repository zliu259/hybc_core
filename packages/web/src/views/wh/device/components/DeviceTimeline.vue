<script setup lang="ts">
import type { DeviceEvent } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../../shared/ids";

const props = defineProps<{ events: DeviceEvent[] }>();
const { userNameOf } = useWecomUserOptions();
</script>

<template>
  <el-empty
    v-if="props.events.length === 0"
    description="还没有记录"
    :image-size="60"
  />
  <el-timeline v-else>
    <el-timeline-item
      v-for="event in props.events"
      :key="event.id"
      :timestamp="formatTime(event.occurred_at)"
    >
      {{ event.summary
      }}<span class="who">· {{ userNameOf(event.operator_userid) }}</span>
    </el-timeline-item>
  </el-timeline>
</template>

<style scoped>
.who {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
