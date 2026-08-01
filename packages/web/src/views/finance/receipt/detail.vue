<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import ReceiptDetailPanel from "./components/ReceiptDetailPanel.vue";

defineOptions({ name: "ReceiptDetail" });

const route = useRoute();
const receiptId = computed(() => Number(route.params.id));
</script>

<template>
  <ReceiptDetailPanel :key="String(route.params.id)" :receipt-id="receiptId" />
</template>
