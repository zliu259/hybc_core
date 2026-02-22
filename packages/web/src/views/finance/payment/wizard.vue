<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listBizThresholds } from "@/api/admin";
import {
  createContract,
  listContracts,
  submitContractApproval,
  type Contract
} from "@/api/contract";
import {
  createPaymentRequest,
  listPayees,
  submitPaymentApproval,
  type Payee
} from "@/api/payment";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "SmartPaymentWizard" });

const loading = ref(false);
const checking = ref(false);
const submitting = ref(false);
const step = ref(0);
const thresholdLimit = ref(50000);
const exceedsThreshold = ref(false);

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const amountInput = ref<number | undefined>(undefined);
const withFirstPayment = ref(false);

const directForm = ref({
  contract_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  payee_id: undefined as number | undefined,
  content: "",
  payment_method: "bank_transfer",
  expected_payment_date: ""
});

const contractForm = ref({
  project_id: undefined as number | undefined,
  entity_id: 1,
  payee_id: undefined as number | undefined,
  contract_type: "outbound_service",
  handler_userid: "",
  contract_date: "",
  remark: ""
});

const firstPaymentForm = ref({
  payee_id: undefined as number | undefined,
  content: "首笔预付款",
  payment_method: "bank_transfer",
  expected_payment_date: ""
});

let checkTimer: ReturnType<typeof setTimeout> | null = null;

const thresholdHint = computed(() =>
  exceedsThreshold.value
    ? `金额超过阈值 ${thresholdLimit.value.toLocaleString()}，请走合同流程`
    : `金额未超过阈值 ${thresholdLimit.value.toLocaleString()}，可直接走付款申请`
);

const selectedContractCounterparty = computed(() => {
  const target = payees.value.find(item => item.id === contractForm.value.payee_id);
  return target ? target.name : "";
});

const loadMeta = async () => {
  const [thresholdRes, payeeRes, contractRes] = await Promise.all([
    listBizThresholds({ biz_type: "payment_request" }).catch(() => null),
    listPayees(),
    listContracts({ direction: "outbound", page: 1, pageSize: 200 })
  ]);

  if (thresholdRes?.data?.length) {
    const min = thresholdRes.data.reduce(
      (acc, cur) => (cur.threshold_value < acc ? cur.threshold_value : acc),
      Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(min)) {
      thresholdLimit.value = min;
    }
  }

  payees.value = payeeRes.data;
  contracts.value = contractRes.data;
  await Promise.all([loadProjects(), loadWecomUsers()]);
};

const checkAmount = () => {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checking.value = true;
    const value = Number(amountInput.value ?? 0);
    exceedsThreshold.value = value > thresholdLimit.value;
    step.value = exceedsThreshold.value ? 1 : 0;
    checking.value = false;
  }, 350);
};

const submitDirectPayment = async () => {
  if (
    !amountInput.value ||
    !directForm.value.contract_id ||
    !directForm.value.project_id ||
    !directForm.value.payee_id
  ) {
    message("请先填写金额、合同、项目、收款人", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const created = await createPaymentRequest({
      contract_id: directForm.value.contract_id,
      project_id: directForm.value.project_id,
      expected_payment_date: directForm.value.expected_payment_date,
      category: "general",
      payee_id: directForm.value.payee_id,
      amount: amountInput.value,
      content: directForm.value.content || "智能发单台创建",
      payment_method: directForm.value.payment_method
    });
    await submitPaymentApproval(created.data.id, {
      biz_summary: "智能发单台-直接付款",
      instance_config: { note: "阈值内直接付款" }
    });
    message("付款申请已创建并提交审批", { type: "success" });
  } finally {
    submitting.value = false;
  }
};

const submitContractFlow = async () => {
  if (
    !amountInput.value ||
    !contractForm.value.project_id ||
    !contractForm.value.payee_id ||
    !contractForm.value.handler_userid
  ) {
    message("请先填写合同关键字段", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const contract = await createContract({
      direction: "outbound",
      project_id: contractForm.value.project_id,
      entity_id: contractForm.value.entity_id,
      counterparty: selectedContractCounterparty.value,
      contract_type: contractForm.value.contract_type,
      handler_userid: contractForm.value.handler_userid,
      contract_date: contractForm.value.contract_date,
      total_amount: amountInput.value,
      remark: contractForm.value.remark
    });

    let paymentId: number | null = null;
    if (withFirstPayment.value && firstPaymentForm.value.payee_id) {
      const payment = await createPaymentRequest({
        contract_id: contract.data.id,
        project_id: contractForm.value.project_id,
        expected_payment_date: firstPaymentForm.value.expected_payment_date,
        category: "prepayment",
        payee_id: firstPaymentForm.value.payee_id,
        amount: amountInput.value,
        content: firstPaymentForm.value.content,
        payment_method: firstPaymentForm.value.payment_method
      });
      paymentId = payment.data.id;
    }

    await submitContractApproval(contract.data.id, {
      biz_summary: "智能发单台-超阈值合同创建",
      instance_config: { note: "超阈值付款自动走合同审批" }
    });

    if (paymentId) {
      await submitPaymentApproval(paymentId, {
        biz_summary: "智能发单台-首笔预付款",
        instance_config: { note: "合同创建后同步发起首笔付款" }
      });
    }

    message("流程已提交：合同审批" + (paymentId ? " + 首笔付款审批" : ""), {
      type: "success"
    });
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await loadMeta();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="wizard-wrap" v-loading="loading">
    <el-card class="wizard-card" shadow="never">
      <template #header>
        <div class="wizard-title">资金流出智能发单台</div>
      </template>

      <el-form label-width="140px">
        <el-form-item label="预计付款总额">
          <el-input-number
            v-model="amountInput"
            :min="0"
            :precision="2"
            :step="1000"
            style="width: 300px"
            @blur="checkAmount"
          />
          <el-tag :type="exceedsThreshold ? 'danger' : 'success'" class="ml-3">
            {{ thresholdHint }}
          </el-tag>
        </el-form-item>
      </el-form>

      <el-steps :active="step" finish-status="success" align-center class="mb-4">
        <el-step title="金额识别" />
        <el-step title="合同流程" :description="exceedsThreshold ? '必经' : '跳过'" />
        <el-step title="首笔预付款" :description="withFirstPayment ? '启用' : '可选'" />
      </el-steps>

      <el-alert :type="exceedsThreshold ? 'warning' : 'info'" :closable="false" show-icon>
        <template #default>
          <span v-if="checking">阈值校验中...</span>
          <span v-else>{{ thresholdHint }}</span>
        </template>
      </el-alert>

      <el-divider />

      <template v-if="!exceedsThreshold">
        <el-form label-width="140px">
          <el-form-item label="合同">
            <el-select v-model="directForm.contract_id" filterable style="width: 360px">
              <el-option
                v-for="item in contracts"
                :key="item.id"
                :label="`${item.contract_no} - ${item.counterparty}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="所属项目">
            <el-select
              v-model="directForm.project_id"
              clearable
              filterable
              placeholder="按时间排序选择项目"
              style="width: 360px"
            >
              <el-option
                v-for="item in projects"
                :key="item.id"
                :label="`${item.project_name} (${item.project_code})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="收款人">
            <el-select v-model="directForm.payee_id" filterable style="width: 360px">
              <el-option
                v-for="item in payees"
                :key="item.id"
                :label="`${item.name} (${item.bank_name})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="付款日期">
            <el-date-picker
              v-model="directForm.expected_payment_date"
              type="date"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item label="付款事由">
            <el-input v-model="directForm.content" />
          </el-form-item>
        </el-form>
        <el-button type="primary" :loading="submitting" @click="submitDirectPayment">
          创建付款并提审
        </el-button>
      </template>

      <template v-else>
        <el-form label-width="140px">
          <el-form-item label="所属项目">
            <el-select
              v-model="contractForm.project_id"
              clearable
              filterable
              placeholder="按时间排序选择项目"
              style="width: 360px"
            >
              <el-option
                v-for="item in projects"
                :key="item.id"
                :label="`${item.project_name} (${item.project_code})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="经营实体ID">
            <el-input-number v-model="contractForm.entity_id" :min="1" style="width: 220px" />
          </el-form-item>
          <el-form-item label="对方单位" required>
            <el-select
              v-model="contractForm.payee_id"
              clearable
              filterable
              placeholder="选择收款单位"
              style="width: 360px"
            >
              <el-option
                v-for="item in payees"
                :key="item.id"
                :label="`${item.name} (${item.bank_name})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="经办人">
            <el-select
              v-model="contractForm.handler_userid"
              clearable
              filterable
              placeholder="选择公司人员"
              style="width: 360px"
            >
              <el-option
                v-for="item in wecomUsers"
                :key="item.userid"
                :label="`${item.name} (${item.userid})`"
                :value="item.userid"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="合同日期">
            <el-date-picker
              v-model="contractForm.contract_date"
              type="date"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="contractForm.remark" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>

        <el-divider />
        <el-form label-width="140px">
          <el-form-item label="同时发起首笔预付款">
            <el-switch v-model="withFirstPayment" />
          </el-form-item>
          <template v-if="withFirstPayment">
            <el-form-item label="首笔收款人">
              <el-select v-model="firstPaymentForm.payee_id" filterable style="width: 360px">
                <el-option
                  v-for="item in payees"
                  :key="item.id"
                  :label="`${item.name} (${item.bank_name})`"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="首笔付款日期">
              <el-date-picker
                v-model="firstPaymentForm.expected_payment_date"
                type="date"
                value-format="YYYY-MM-DD"
              />
            </el-form-item>
          </template>
        </el-form>
        <el-button type="primary" :loading="submitting" @click="submitContractFlow">
          创建合同并提审
        </el-button>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.wizard-wrap {
  display: flex;
  justify-content: center;
  padding: 18px 12px;
}

.wizard-card {
  width: min(960px, 100%);
  background: #fffaf2;
}

.wizard-title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}
</style>
