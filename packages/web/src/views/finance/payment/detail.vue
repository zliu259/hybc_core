<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  createPaymentRequest,
  getPaymentRequest,
  getRiskReport,
  markPaymentPaid,
  triggerRiskAssessment,
  updatePaymentRequest,
  listPayees,
  type Payee,
  type PaymentRequestDetail
} from "@/api/payment";
import { listContracts, type Contract } from "@/api/contract";

defineOptions({ name: "PaymentDetail" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);

const isCreate = computed(() => route.params.id === "create");
const requestId = computed(() => Number(route.params.id));

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const detail = ref<PaymentRequestDetail | null>(null);

const form = ref({
  contract_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  expected_payment_date: "",
  category: "",
  payee_id: undefined as number | undefined,
  amount: 0,
  content: "",
  payment_method: "",
  remark: ""
});

const selectedContract = computed(() => {
  return contracts.value.find(item => item.id === form.value.contract_id) ?? null;
});

const remainingAmount = computed(() => {
  if (!selectedContract.value) return 0;
  return selectedContract.value.total_amount - selectedContract.value.paid_amount;
});

const riskStatus = ref("none");
const riskReport = ref<Record<string, unknown> | null>(null);
const riskTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const loadRefs = async () => {
  const [contractRes, payeeRes] = await Promise.all([
    listContracts({ page: 1, pageSize: 400, direction: "outbound" }),
    listPayees()
  ]);
  contracts.value = contractRes.data;
  payees.value = payeeRes.data;
};

const onSelectContract = (contractId?: number) => {
  const selected = contracts.value.find(item => item.id === contractId);
  if (!selected) return;
  form.value.project_id = selected.project_id;
};

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getPaymentRequest(requestId.value);
    detail.value = result.data;
    form.value = {
      contract_id: result.data.contract_id,
      project_id: result.data.project_id,
      expected_payment_date: result.data.expected_payment_date,
      category: result.data.category,
      payee_id: result.data.payee_id,
      amount: result.data.amount,
      content: result.data.content,
      payment_method: result.data.payment_method,
      remark: result.data.remark ?? ""
    };
    const rr = await getRiskReport(requestId.value);
    riskStatus.value = rr.data.status;
    riskReport.value = rr.data.result;
  } finally {
    loading.value = false;
  }
};

const onSave = async () => {
  if (!form.value.contract_id || !form.value.project_id || !form.value.payee_id) {
    message("请填写完整信息", { type: "warning" });
    return;
  }
  if (form.value.amount > remainingAmount.value && isCreate.value) {
    message("申请金额超过合同剩余额度", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    if (isCreate.value) {
      const result = await createPaymentRequest({
        contract_id: form.value.contract_id,
        project_id: form.value.project_id,
        expected_payment_date: form.value.expected_payment_date,
        category: form.value.category,
        payee_id: form.value.payee_id,
        amount: form.value.amount,
        content: form.value.content,
        payment_method: form.value.payment_method,
        remark: form.value.remark
      });
      message(`创建成功，金额大写：${result.data.amount_cn}`, { type: "success" });
      router.replace(`/finance/payment/detail/${result.data.id}`);
      return;
    }

    await updatePaymentRequest(requestId.value, {
      expected_payment_date: form.value.expected_payment_date,
      category: form.value.category,
      payee_id: form.value.payee_id,
      amount: form.value.amount,
      content: form.value.content,
      payment_method: form.value.payment_method,
      remark: form.value.remark
    });
    message("保存成功", { type: "success" });
    await loadDetail();
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const onSubmitApproval = async () => {
  if (isCreate.value) {
    message("请先保存申请", { type: "warning" });
    return;
  }
  await updatePaymentRequest(requestId.value, { status: "pending_approval" });
  message("已提交审批", { type: "success" });
  await loadDetail();
};

const onRiskAssessment = async () => {
  if (isCreate.value) {
    message("请先保存申请", { type: "warning" });
    return;
  }
  await triggerRiskAssessment(requestId.value);
  message("已触发风险评估", { type: "success" });
  await loadDetail();
};

const onMarkPaid = async () => {
  if (isCreate.value) return;
  await markPaymentPaid(requestId.value);
  message("已标记为已付款", { type: "success" });
  await loadDetail();
};

onMounted(async () => {
  await loadRefs();
  await loadDetail();
});
</script>

<template>
  <el-card shadow="never" :loading="loading" style="background: #fffaf2">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>{{ isCreate ? "新建付款申请" : `付款详情 - ${detail?.serial_no || ''}` }}</span>
        <div>
          <el-button @click="router.push('/finance/payment')">返回</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
          <el-button type="warning" :disabled="isCreate" @click="onSubmitApproval">提交审批</el-button>
          <el-button type="success" :disabled="isCreate" @click="onRiskAssessment">触发风险评估</el-button>
          <el-button
            type="primary"
            plain
            :disabled="isCreate || detail?.status !== 'approved'"
            @click="onMarkPaid"
          >
            标记付款
          </el-button>
        </div>
      </div>
    </template>

    <el-form label-width="120px" style="max-width: 900px">
      <el-form-item label="关联合同">
        <el-select
          v-model="form.contract_id"
          filterable
          clearable
          style="width: 360px"
          :disabled="!isCreate"
          @change="onSelectContract"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :value="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="所属项目">
        <el-input :model-value="String(form.project_id || '')" disabled style="width: 180px" />
      </el-form-item>

      <el-form-item label="剩余额度">
        <el-tag type="success">{{ remainingAmount.toFixed(2) }}</el-tag>
      </el-form-item>

      <el-form-item label="付款类别">
        <el-select v-model="form.category" clearable style="width: 220px">
          <el-option label="特殊审批" value="特殊审批" />
          <el-option label="行政费" value="行政费" />
          <el-option label="劳务费" value="劳务费" />
          <el-option label="机械费" value="机械费" />
          <el-option label="材料费" value="材料费" />
          <el-option label="其他费用" value="其他费用" />
        </el-select>
      </el-form-item>

      <el-form-item label="收款人">
        <el-select v-model="form.payee_id" filterable clearable style="width: 360px">
          <el-option
            v-for="item in payees"
            :key="item.id"
            :value="item.id"
            :label="`${item.name} (${item.bank_account})`"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="申请金额">
        <el-input-number v-model="form.amount" :min="0" :precision="2" :step="1000" />
      </el-form-item>

      <el-form-item label="预计付款日">
        <el-date-picker
          v-model="form.expected_payment_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>

      <el-form-item label="付款方式">
        <el-select v-model="form.payment_method" clearable style="width: 220px">
          <el-option label="对公转账" value="对公转账" />
          <el-option label="现金" value="现金" />
          <el-option label="票据" value="票据" />
          <el-option label="其他" value="其他" />
        </el-select>
      </el-form-item>

      <el-form-item label="付款内容">
        <el-input v-model="form.content" type="textarea" :rows="3" />
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>

    <el-divider v-if="detail">申请摘要</el-divider>
    <el-descriptions v-if="detail" :column="2" border>
      <el-descriptions-item label="流水号">{{ detail.serial_no }}</el-descriptions-item>
      <el-descriptions-item label="状态">{{ detail.status }}</el-descriptions-item>
      <el-descriptions-item label="对方单位">{{ detail.contract?.counterparty || "-" }}</el-descriptions-item>
      <el-descriptions-item label="收款人">{{ detail.payee?.name || "-" }}</el-descriptions-item>
      <el-descriptions-item label="金额大写" :span="2">{{ detail.amount_cn }}</el-descriptions-item>
    </el-descriptions>

    <el-divider v-if="detail">AI风险评估</el-divider>
    <div v-if="detail" style="margin-bottom: 8px">
      <el-tag :type="riskTagType[riskStatus] || 'info'">{{ riskStatus }}</el-tag>
    </div>
    <el-descriptions v-if="riskReport" :column="2" border>
      <el-descriptions-item label="风险等级">{{ riskReport.overall_risk || "-" }}</el-descriptions-item>
      <el-descriptions-item label="风险分数">{{ riskReport.score ?? "-" }}</el-descriptions-item>
      <el-descriptions-item label="总结" :span="2">{{ riskReport.summary || "-" }}</el-descriptions-item>
      <el-descriptions-item label="建议" :span="2">
        {{ Array.isArray(riskReport.recommendations) ? riskReport.recommendations.join("；") : "-" }}
      </el-descriptions-item>
    </el-descriptions>
  </el-card>
</template>
