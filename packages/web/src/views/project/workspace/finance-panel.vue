<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getProjectFinancialSummary } from "@/api/project";

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

const showAmount = (value: number) => {
  if (props.maskSensitive) return "***";
  return value;
};

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
      <el-descriptions :column="1" border>
        <el-descriptions-item label="对外付款已支付">
          {{ showAmount(summary.outboundPaidAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="收款已开票">
          {{ showAmount(summary.inboundInvoicedAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="收款已到账">
          {{ showAmount(summary.inboundReceivedAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="报销累计">
          {{ showAmount(summary.reimbursementAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="收款登记笔数">
          {{ summary.receiptCount }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card shadow="never" header="快捷入口" class="mt-3">
      <el-space>
        <el-button @click="goTo('/finance/contract')">合同管理</el-button>
        <el-button @click="goTo('/finance/payment')">付款管理</el-button>
        <el-button @click="goTo('/finance/receipt')">收款登记</el-button>
        <el-button @click="goTo('/finance/reimbursement')">报销信封</el-button>
      </el-space>
    </el-card>
  </div>
</template>
