<script setup lang="ts">
/** 头部的执行进度：付款合同看已付和余额，收款合同看开票和到账。 */
import { computed } from "vue";
import type { ContractDetail } from "@/api/contract";
import { formatMoney } from "../../shared/format";
import { buildContractProgress } from "../contract-detail-view";

defineOptions({ name: "ContractProgress" });

const props = defineProps<{ detail: ContractDetail }>();

const progress = computed(() => buildContractProgress(props.detail));
</script>

<template>
  <div class="contract-progress">
    <div
      v-for="row in progress.rows"
      :key="row.label"
      class="contract-progress__row"
    >
      <div class="contract-progress__figures">
        <span>
          {{ row.label }}
          <b>{{ formatMoney(row.done) }}</b>
          <template v-if="row.percent !== null">
            / {{ formatMoney(row.total) }}
          </template>
        </span>
        <span v-if="progress.remaining !== null">
          剩余 <b>{{ formatMoney(progress.remaining) }}</b>
        </span>
      </div>
      <el-progress
        v-if="row.percent !== null"
        :percentage="row.percent"
        :stroke-width="8"
        :color="row.over ? '' : '#c9a35c'"
        :status="row.over ? 'exception' : ''"
      />
    </div>
  </div>
</template>

<style scoped>
.contract-progress__row + .contract-progress__row {
  margin-top: 8px;
}

.contract-progress__figures {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
  margin-bottom: 6px;
  font-size: 13px;
  color: #6e6458;
}

.contract-progress__figures b {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  color: #3f3527;
}
</style>
