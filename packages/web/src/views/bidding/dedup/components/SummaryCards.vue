<script setup lang="ts">
import type { DedupResult, ParsedDoc } from "../lib/types";

const props = defineProps<{ results: DedupResult[]; docs: ParsedDoc[] }>();

function docName(id: string): string {
  return props.docs.find((d) => d.id === id)?.name ?? id;
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function tone(v: number): string {
  if (v >= 0.3) return "danger";
  if (v >= 0.15) return "warning";
  return "success";
}
</script>

<template>
  <div class="summary-cards">
    <el-card v-for="r in props.results" :key="r.compareDocId" shadow="never">
      <div class="label">{{ docName(r.compareDocId) }} 与母本重复率</div>
      <div class="value" :class="tone(r.charDuplicateRate)">
        {{ pct(r.charDuplicateRate) }}
      </div>
      <div class="sub">句数重复率 {{ pct(r.sentDuplicateRate) }}</div>
    </el-card>
  </div>
</template>

<style scoped>
.value {
  font-size: 24px;
  font-weight: 500;
}
.value.danger {
  color: var(--el-color-danger);
}
.value.warning {
  color: var(--el-color-warning);
}
.value.success {
  color: var(--el-color-success);
}
</style>
