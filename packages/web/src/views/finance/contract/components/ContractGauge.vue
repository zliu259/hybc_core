<script setup lang="ts">
/** 列表行内的进度：付款合同看已付和额度刻度，收款合同看到账，已开票垫在底下。 */
import { computed } from "vue";
import type { Contract } from "@/api/contract";
import { formatMoney } from "../../shared/format";
import { buildContractGauge } from "../contract-overview-view";

defineOptions({ name: "ContractGauge" });

const props = defineProps<{ row: Contract }>();

const gauge = computed(() => buildContractGauge(props.row));
</script>

<template>
  <div class="contract-gauge">
    <div class="contract-gauge__figures">
      <span>
        {{ gauge.doneLabel }} <b>{{ formatMoney(gauge.done) }}</b>
        <template v-if="gauge.percent !== null">
          / {{ formatMoney(gauge.total) }}
        </template>
      </span>
      <span
        v-if="gauge.note"
        :class="{ 'contract-gauge__note--alarm': gauge.note.alarm }"
      >
        {{ gauge.note.label }} <b>{{ formatMoney(gauge.note.amount) }}</b>
      </span>
      <span v-else class="contract-gauge__unpriced">单价合同，未定总额</span>
    </div>

    <div v-if="gauge.percent !== null" class="contract-gauge__bar">
      <div
        class="contract-gauge__track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="gauge.fillWidth"
        :aria-label="`${gauge.doneLabel}占合同额的比例`"
      >
        <span
          v-if="gauge.invoiced"
          class="contract-gauge__invoiced"
          :style="{ width: `${gauge.invoiced.width}%` }"
        />
        <span
          class="contract-gauge__fill"
          :style="{ width: `${gauge.fillWidth}%`, background: gauge.color }"
        />
        <span
          v-for="tick in gauge.ticks"
          :key="tick"
          class="contract-gauge__tick"
          :style="{ left: `${tick}%` }"
        />
      </div>
      <span class="contract-gauge__percent">{{ gauge.percent }}%</span>
    </div>

    <div v-if="gauge.invoiced" class="contract-gauge__invoice-line">
      已开票 <b>{{ formatMoney(gauge.invoiced.amount) }}</b>
    </div>
  </div>
</template>

<style scoped>
.contract-gauge {
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: #6e6458;
}

.contract-gauge b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #3f3527;
}

.contract-gauge__figures {
  display: flex;
  flex-wrap: wrap;
  gap: 0 16px;
  justify-content: space-between;
}

.contract-gauge__note--alarm,
.contract-gauge__note--alarm b {
  font-weight: 600;
  color: #6f1616;
}

.contract-gauge__unpriced {
  color: #8c8171;
}

.contract-gauge__bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}

.contract-gauge__track {
  position: relative;
  flex: 1;
  height: 8px;
  background: #f1e8d6;
  border-radius: 2px;
}

.contract-gauge__fill,
.contract-gauge__invoiced {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  border-radius: 2px;
}

.contract-gauge__invoiced {
  background: #dcc99f;
}

/* 刻度探出进度条上下各 2px，满格时也看得见 */
.contract-gauge__tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: #8c7a56;
}

.contract-gauge__percent {
  width: 44px;
  font-variant-numeric: tabular-nums;
  color: #3f3527;
  text-align: right;
}

.contract-gauge__invoice-line {
  margin-top: 2px;
}
</style>
