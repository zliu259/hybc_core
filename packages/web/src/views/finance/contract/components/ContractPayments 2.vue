<script setup lang="ts">
/** 关联付款申请。只有付款合同才有。 */
import { computed, ref } from "vue";
import type { ContractDetail } from "@/api/contract";
import { formatBeijingDateTime } from "@/utils/datetime";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import PaymentDetailDrawer from "../../payment/components/PaymentDetailDrawer.vue";
import {
  paymentStatusTagType,
  toPaymentStatusLabel
} from "../../payment/payment-labels";
import { effectivePaymentTotal } from "../contract-detail-view";

defineOptions({ name: "ContractPayments" });

type PaymentRow = ContractDetail["payment_requests"][number];

const props = defineProps<{ rows: PaymentRow[] }>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const activeId = ref<number | null>(null);
const drawerVisible = ref(false);
const effectiveTotal = computed(() => effectivePaymentTotal(props.rows));

const open = (row: PaymentRow) => {
  activeId.value = row.id;
  drawerVisible.value = true;
};

const onDrawerClosed = () => {
  activeId.value = null;
  // 付款可能在抽屉里被标记或作废，已付金额要跟着刷新
  emit("refresh");
};
</script>

<template>
  <FinSection title="关联付款申请">
    <template #extra>
      <span class="contract-payments__stat">
        共 {{ rows.length }} 笔 / 有效合计 {{ formatMoney(effectiveTotal) }}
      </span>
    </template>
    <el-table
      v-if="rows.length"
      class="contract-payments__table"
      :data="rows"
      size="small"
      @row-click="open"
    >
      <el-table-column label="流水号" min-width="170">
        <template #default="scope">
          <span class="contract-payments__no">{{ scope.row.serial_no }}</span>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="140" align="right">
        <template #default="scope">
          {{ formatMoney(scope.row.amount) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="paymentStatusTagType[scope.row.status] || 'info'">
            {{ toPaymentStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="scope">
          {{ formatBeijingDateTime(scope.row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click.stop="open(scope.row)">
            查看
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <p v-else class="contract-payments__empty">还没有关联付款</p>

    <PaymentDetailDrawer
      v-model:visible="drawerVisible"
      :request-id="activeId"
      @closed="onDrawerClosed"
    />
  </FinSection>
</template>

<style scoped>
.contract-payments__stat {
  font-size: 12px;
  color: #8c6a2f;
}

.contract-payments__no {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.contract-payments__empty {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.contract-payments__table :deep(.el-table__row) {
  cursor: pointer;
}
</style>
