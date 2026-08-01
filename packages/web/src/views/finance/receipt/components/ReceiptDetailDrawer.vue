<script setup lang="ts">
import ReceiptDetailPanel from "./ReceiptDetailPanel.vue";

defineProps<{
  visible: boolean;
  receiptId: number | null;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "closed"): void;
}>();
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="收款登记详情"
    size="640px"
    direction="rtl"
    destroy-on-close
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @closed="emit('closed')"
  >
    <ReceiptDetailPanel v-if="receiptId !== null" :receipt-id="receiptId" />
  </el-drawer>
</template>
