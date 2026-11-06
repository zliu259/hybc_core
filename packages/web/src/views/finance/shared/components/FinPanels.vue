<script setup lang="ts">
/**
 * 详情页主体。里面复用的审批详情面板（AI 审查、审批流程、附件）换成财务页的分节样式，
 * 整页看起来是一套。
 */
defineOptions({ name: "FinPanels" });
</script>

<template>
  <div class="fin-panels"><slot /></div>
</template>

<style scoped>
.fin-panels :deep(.approval-panel) {
  padding: 0;
  margin-top: 20px;
  background: transparent;
  border: none;
  border-radius: 0;
}

.fin-panels :deep(.approval-panel__head) {
  gap: 10px;
  justify-content: flex-start;
  margin-bottom: 10px;
}

.fin-panels :deep(.approval-panel__head)::after {
  flex: 1;
  order: 1;
  content: "";
  border-top: 1px dashed #e3d5b8;
}

.fin-panels :deep(.approval-panel__head > *) {
  order: 2;
}

.fin-panels :deep(.approval-panel__title) {
  flex-shrink: 0;
  order: 0;
  padding-left: 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  color: #6b4f2a;
  letter-spacing: 0.06em;
  border-left: 3px solid #c9a35c;
}
</style>
