<script setup lang="ts">
import ProjectReceiptPanel from "./ProjectReceiptPanel.vue";

defineProps<{
  visible: boolean;
  projectId: number | null;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "closed"): void;
}>();
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="项目收款全貌"
    size="75%"
    direction="rtl"
    destroy-on-close
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @closed="emit('closed')"
  >
    <ProjectReceiptPanel
      v-if="projectId !== null"
      :project-id="projectId"
      @nav="emit('update:visible', false)"
    />
  </el-drawer>
</template>
