<script setup lang="ts">
defineOptions({ name: "FinSection" });

defineProps<{
  title: string;
}>();
</script>

<template>
  <section class="fin-section">
    <div class="fin-section__head">
      <span class="fin-section__title">{{ title }}</span>
      <span class="fin-section__rule" aria-hidden="true" />
      <div v-if="$slots.extra" class="fin-section__extra">
        <slot name="extra" />
      </div>
    </div>
    <div class="fin-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.fin-section {
  margin-top: 20px;
}

.fin-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.fin-section__title {
  flex-shrink: 0;
  padding-left: 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  color: #6b4f2a;
  letter-spacing: 0.06em;
  border-left: 3px solid #c9a35c;
}

.fin-section__rule {
  flex: 1;
  border-top: 1px dashed #e3d5b8;
}

.fin-section__extra {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}
</style>
