<script setup lang="ts">
import { computed } from "vue";

import type { StocktakeDetail } from "@/api/wh/stocktake-types";
import { completeSummary } from "../stocktake-view";

/** 完成盘点前的确认：把会发生什么一条条列出来。完成之后不能再改。 */
const props = defineProps<{
  detail: StocktakeDetail | null;
  busy: boolean;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ confirm: [] }>();

const lines = computed(() =>
  props.detail ? completeSummary(props.detail) : []
);
</script>

<template>
  <el-dialog
    v-model="visible"
    title="完成盘点"
    width="480px"
    :close-on-click-modal="false"
  >
    <ul class="summary">
      <li v-for="line in lines" :key="line">{{ line }}</li>
    </ul>
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="完成之后不能再改。调整单不能冲销，调错了要再盘一次。"
    />
    <template #footer>
      <el-button @click="visible = false">再看看</el-button>
      <el-button type="primary" :loading="props.busy" @click="emit('confirm')"
        >完成盘点</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.summary {
  padding-left: 20px;
  margin: 0 0 16px;
  line-height: 1.9;
}
</style>
