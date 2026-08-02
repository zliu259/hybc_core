<script setup lang="ts">
import ContractDetailPanel from "./ContractDetailPanel.vue";

defineProps<{
  visible: boolean;
  contractId: number | null;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "closed"): void;
  /** 面板发起页面级跳转：本抽屉关闭并继续向上冒泡，让外层抽屉一并关闭 */
  (e: "nav"): void;
}>();

const onPanelNav = () => {
  emit("update:visible", false);
  emit("nav");
};
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="合同详情"
    size="72%"
    direction="rtl"
    destroy-on-close
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @closed="emit('closed')"
  >
    <ContractDetailPanel
      v-if="contractId !== null"
      :contract-id="contractId"
      @back="emit('update:visible', false)"
      @created="emit('update:visible', false)"
      @nav="onPanelNav"
    />
  </el-drawer>
</template>
