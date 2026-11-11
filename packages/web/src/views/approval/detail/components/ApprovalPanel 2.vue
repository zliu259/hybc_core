<script setup lang="ts">
defineOptions({ name: "ApprovalPanel" });

defineProps<{ title?: string }>();
</script>

<template>
  <section class="approval-panel">
    <header v-if="title || $slots.extra" class="approval-panel__head">
      <h2 class="approval-panel__title">{{ title }}</h2>
      <slot name="extra" />
    </header>
    <slot />
  </section>
</template>

<style scoped>
.approval-panel {
  padding: 16px 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.approval-panel__head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.approval-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}
</style>
