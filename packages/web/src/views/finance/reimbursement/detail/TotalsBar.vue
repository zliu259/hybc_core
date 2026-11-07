<script setup lang="ts">
import { computed } from "vue";

import type { ReviewTotals } from "@/api/reimbursement";
import { totalsDisplay } from "./view-model";

const props = defineProps<{ totals: ReviewTotals }>();

const display = computed(() => totalsDisplay(props.totals));
</script>

<template>
  <footer class="rb-total">
    <span
      >票面合计 <strong>{{ display.extracted }}</strong></span
    >
    <span
      >申报 <strong>{{ display.declared }}</strong></span
    >
    <span v-if="display.delta">
      差额
      <strong
        :class="{
          'rb-ok': display.tone === 'ok',
          'rb-bad': display.tone === 'warn'
        }"
      >
        {{ display.delta }}
      </strong>
    </span>
  </footer>
</template>

<style scoped>
.rb-total {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  justify-content: flex-end;
  padding: 12px 24px;
  font-size: 13px;
  line-height: 20px;
  color: #5c667a;
  border-top: 1px solid #e7ebf0;
}

.rb-total strong {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #1f2329;
}

.rb-total .rb-ok {
  color: #15803d;
}

.rb-total .rb-bad {
  color: #b4470c;
}

@container (max-width: 860px) {
  .rb-total {
    padding: 12px 16px;
  }
}
</style>
