<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getProjectFinancialSummary } from "@/api/project";
import ProjectReceiptDrawer from "@/views/finance/receipt/components/ProjectReceiptDrawer.vue";
import { formatMoney } from "@/views/finance/shared/format";

const props = defineProps<{
  projectId: number;
  maskSensitive: boolean;
}>();

const router = useRouter();
const loading = ref(false);
const summary = ref({
  outboundPaidAmount: 0,
  inboundInvoicedAmount: 0,
  inboundReceivedAmount: 0,
  reimbursementAmount: 0,
  receiptCount: 0
});
const receiptDrawerVisible = ref(false);

const showAmount = (value: number) => {
  if (props.maskSensitive) return "***";
  return formatMoney(value);
};

const statBlocks = computed(() => [
  { label: "对外付款已支付", value: summary.value.outboundPaidAmount },
  { label: "收款已开票", value: summary.value.inboundInvoicedAmount },
  { label: "收款已到账", value: summary.value.inboundReceivedAmount },
  { label: "报销累计", value: summary.value.reimbursementAmount }
]);

const loadSummary = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    const result = await getProjectFinancialSummary(props.projectId);
    summary.value = result.data;
  } finally {
    loading.value = false;
  }
};

const goTo = (path: string) => {
  router.push(path);
};

watch(
  () => props.projectId,
  () => {
    void loadSummary();
  }
);

onMounted(loadSummary);
</script>

<template>
  <div v-loading="loading">
    <el-card shadow="never" header="项目财务摘要">
      <el-row :gutter="12">
        <el-col v-for="item in statBlocks" :key="item.label" :md="6" :xs="12">
          <div class="stat-card">
            <div class="stat-card__label">{{ item.label }}</div>
            <div class="stat-card__value">{{ showAmount(item.value) }}</div>
          </div>
        </el-col>
      </el-row>
      <div class="stat-footer">
        <span class="stat-footnote">
          收款登记 {{ summary.receiptCount }} 笔
        </span>
        <el-button
          v-if="!maskSensitive"
          type="primary"
          @click="receiptDrawerVisible = true"
        >
          项目收款全貌
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never" header="快捷入口" class="mt-3">
      <el-space>
        <el-button @click="goTo('/finance/contract')">合同管理</el-button>
        <el-button @click="goTo('/finance/payment')">付款管理</el-button>
        <el-button @click="goTo('/finance/receipt')">收款登记</el-button>
        <el-button @click="goTo('/finance/reimbursement')">报销信封</el-button>
      </el-space>
    </el-card>

    <ProjectReceiptDrawer
      v-model:visible="receiptDrawerVisible"
      :project-id="projectId"
      @closed="loadSummary"
    />
  </div>
</template>

<style scoped>
.stat-card {
  padding: 12px 14px;
  margin-bottom: 12px;
  background: linear-gradient(180deg, #fffdf7 0%, #fffaf2 100%);
  border: 1px solid #e3d5b8;
  border-radius: 8px;
}

.stat-card__label {
  font-size: 12px;
  color: #8c6a2f;
}

.stat-card__value {
  margin-top: 4px;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
  color: #6b4f2a;
  font-variant-numeric: tabular-nums;
}

.stat-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.stat-footnote {
  font-size: 12px;
  color: #6e6458;
}
</style>
