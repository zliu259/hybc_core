<script setup lang="ts">
/** AI 实际读了多少附件。读全时一行带过，没读全时必须醒目：结论可能因此不成立。 */
import type { AiEvidenceCoverage } from "@/api/approval";

defineOptions({ name: "AiCoverageNote" });

defineProps<{ coverage: AiEvidenceCoverage }>();
</script>

<template>
  <el-alert
    v-if="!coverage.complete"
    type="warning"
    :closable="false"
    show-icon
    title="AI 没有读完全部附件，结论仅供参考，请对照原件核实"
    class="coverage-note__alert"
  >
    <ul class="coverage-note__list">
      <li
        v-for="item in coverage.items.filter(row => row.status !== 'complete')"
        :key="item.name"
      >
        {{ item.description }}
      </li>
    </ul>
  </el-alert>
  <p v-else class="coverage-note__ok">
    AI 已读完全部附件
    <template v-if="coverage.items.length > 0">
      （{{ coverage.items.map(row => row.description).join("；") }}）
    </template>
  </p>
</template>

<style scoped>
.coverage-note__alert {
  margin-bottom: 12px;
}

.coverage-note__list {
  padding-left: 16px;
  margin: 4px 0 0;
  line-height: 1.6;
}

.coverage-note__ok {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
