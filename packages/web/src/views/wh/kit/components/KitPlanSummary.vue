<script setup lang="ts">
import { computed } from "vue";

import type { KitPlanView } from "@/api/wh/kit-types";
import { planSummaryParts } from "../kit-plan-view";

/** 清单详情顶部：这份清单生成时确认过的参数和所用的模板。只读。 */
const props = defineProps<{ plan: KitPlanView }>();

const parts = computed(() => planSummaryParts(props.plan.params));
</script>

<template>
  <div class="plan-summary">
    <el-tag size="small" type="info">按项目参数生成</el-tag>
    <span class="params">{{ parts.join(" · ") }}</span>
    <span class="template">模板：{{ props.plan.template.name }}</span>
  </div>
</template>

<style scoped>
.plan-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  align-items: center;
  margin: 8px 0;
  font-size: 13px;
}

.template {
  color: var(--el-text-color-secondary);
}
</style>
