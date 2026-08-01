<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import PaymentDetailPanel from "./components/PaymentDetailPanel.vue";

defineOptions({ name: "PaymentDetail" });

const route = useRoute();
const router = useRouter();

const requestId = computed(() => Number(route.params.id));
const inWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));
const paymentListPath = computed(() =>
  inWorkspaceRoute.value ? "/workspace/payment/wizard" : "/finance/payment"
);
const autoEdit = computed(() => route.query.edit === "1");
</script>

<template>
  <PaymentDetailPanel
    :key="String(route.params.id)"
    :request-id="requestId"
    :auto-edit="autoEdit"
    @back="router.push(paymentListPath)"
  />
</template>
