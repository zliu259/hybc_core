<script setup lang="ts">
import PaymentDetailPanel from "./PaymentDetailPanel.vue";

defineProps<{
  visible: boolean;
  requestId: number | null;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "closed"): void;
}>();
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="付款详情"
    size="72%"
    direction="rtl"
    destroy-on-close
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @closed="emit('closed')"
  >
    <PaymentDetailPanel
      v-if="requestId !== null"
      :request-id="requestId"
      @back="emit('update:visible', false)"
    />
  </el-drawer>
</template>
