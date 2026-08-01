<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import ContractDetailPanel from "./components/ContractDetailPanel.vue";

defineOptions({ name: "ContractDetail" });

const route = useRoute();
const router = useRouter();

const isCreate = computed(() => route.params.id === "create");
const contractId = computed(() =>
  isCreate.value ? undefined : Number(route.params.id)
);
const initialDirection = computed(() => {
  const direction = route.query.direction;
  return direction === "inbound" || direction === "outbound"
    ? direction
    : undefined;
});

const onBack = () => {
  router.push("/finance/contract");
};

const onCreated = (id: number) => {
  router.replace(`/finance/contract/detail/${id}`);
};
</script>

<template>
  <ContractDetailPanel
    :key="String(route.params.id)"
    :contract-id="contractId"
    :initial-direction="initialDirection"
    @back="onBack"
    @created="onCreated"
  />
</template>
