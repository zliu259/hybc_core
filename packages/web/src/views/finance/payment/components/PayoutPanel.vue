<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";
import { message } from "@/utils/message";
import {
  markPaymentPaid,
  reactivatePayment,
  updatePaymentRequest,
  voidPayment,
  type PaymentRequestDetail
} from "@/api/payment";
import type { Contract } from "@/api/contract";
import type { Entity, EntityBankAccount } from "@/api/entity";
import type { ApprovalDetailResponse } from "@/api/approval";
import { useUserStoreHook } from "@/store/modules/user";
import FinSection from "../../shared/components/FinSection.vue";
import { formatBeijingDateTime } from "../payment-labels";

defineOptions({ name: "PaymentPayoutPanel" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  entities: Entity[];
  entityBankAccountMap: Record<number, EntityBankAccount[]>;
  inApprovalFlow: boolean;
  contracts: Contract[];
  approvalDetail: ApprovalDetailResponse | null;
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const userStore = useUserStoreHook();
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const voiding = ref(false);
const reactivating = ref(false);
const payoutSaving = ref(false);
const paidDialogVisible = ref(false);
const paidSubmitting = ref(false);
const paidForm = ref({
  paid_at: "",
  payment_reference: "",
  payment_account: "",
  remark: ""
});

const payoutForm = ref({
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined,
  payment_account: ""
});

const selectedContract = computed(() => {
  return (
    props.contracts.find(item => item.id === props.detail?.contract_id) ?? null
  );
});

const selectedEntityAccount = computed(() => {
  const entityId = selectedContract.value?.entity_id;
  if (!entityId) return null;
  const accounts = props.entityBankAccountMap[entityId] ?? [];
  return accounts.find(item => item.status === "active") ?? accounts[0] ?? null;
});

const payoutEntity = computed(() => {
  if (!payoutForm.value.payment_entity_id) return null;
  return (
    props.entities.find(
      item => item.id === payoutForm.value.payment_entity_id
    ) ?? null
  );
});

const payoutEntityAccounts = computed(() => {
  if (!payoutForm.value.payment_entity_id) return [];
  return (
    props.entityBankAccountMap[payoutForm.value.payment_entity_id] ?? []
  ).filter(item => item.status === "active");
});

const canAdjustPayoutInApproval = computed(() => {
  if (!props.inApprovalFlow) return false;
  return Boolean(props.approvalDetail);
});

/** 是否存在可见的付款动作按钮：普通用户仅在已审批时可标记付款，超管始终可见废除/激活 */
const hasPayoutActions = computed(() => {
  if (!props.detail) return false;
  return props.detail.status === "approved" || isSuperAdmin.value;
});

const onPayoutEntityChange = (entityId: number | undefined) => {
  if (!entityId) {
    payoutForm.value.payment_entity_bank_account_id = undefined;
    payoutForm.value.payment_account = "";
    return;
  }
  const accounts = (props.entityBankAccountMap[entityId] ?? []).filter(
    item => item.status === "active"
  );
  if (accounts.length > 0) {
    payoutForm.value.payment_entity_bank_account_id = accounts[0].id;
    payoutForm.value.payment_account = `${accounts[0].bank_name} / ${accounts[0].account_no}`;
  } else {
    payoutForm.value.payment_entity_bank_account_id = undefined;
    payoutForm.value.payment_account = "";
  }
};

const onPayoutAccountChange = (accountId: number | undefined) => {
  if (!accountId) {
    payoutForm.value.payment_account = "";
    return;
  }
  const target = payoutEntityAccounts.value.find(item => item.id === accountId);
  payoutForm.value.payment_account = target
    ? `${target.bank_name} / ${target.account_no}`
    : "";
};

const savePayoutSelection = async () => {
  if (!props.detail) return;
  if (!payoutForm.value.payment_entity_id) {
    message("请选择付款主体", { type: "warning" });
    return;
  }
  if (!payoutForm.value.payment_entity_bank_account_id) {
    message("请选择付款账户", { type: "warning" });
    return;
  }

  payoutSaving.value = true;
  try {
    await updatePaymentRequest(props.detail.id, {
      payment_entity_id: payoutForm.value.payment_entity_id,
      payment_entity_bank_account_id:
        payoutForm.value.payment_entity_bank_account_id,
      payment_account: payoutForm.value.payment_account || null
    });
    message("付款主体与账户已更新", { type: "success" });
    emit("refresh");
  } finally {
    payoutSaving.value = false;
  }
};

const onMarkPaid = async () => {
  paidForm.value = {
    paid_at: new Date().toISOString().slice(0, 10),
    payment_reference: "",
    payment_account:
      props.detail?.payment_account ??
      (selectedEntityAccount.value
        ? `${selectedEntityAccount.value.bank_name} / ${selectedEntityAccount.value.account_no}`
        : ""),
    remark: ""
  };
  paidDialogVisible.value = true;
};

const confirmMarkPaid = async () => {
  if (!props.detail) return;
  paidSubmitting.value = true;
  try {
    await markPaymentPaid(props.detail.id, {
      paid_at: paidForm.value.paid_at || undefined,
      payment_reference: paidForm.value.payment_reference || undefined,
      payment_account: paidForm.value.payment_account || undefined,
      remark: paidForm.value.remark || undefined
    });
    paidDialogVisible.value = false;
    message("已标记为已付款", { type: "success" });
    emit("refresh");
  } finally {
    paidSubmitting.value = false;
  }
};

const onVoidPayment = async () => {
  if (!isSuperAdmin.value || !props.detail) return;
  try {
    await ElMessageBox.confirm(
      "确认废除该付款申请？废除后将不再出现在付款列表中。",
      "废除付款",
      {
        confirmButtonText: "确认废除",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
  } catch {
    return;
  }

  voiding.value = true;
  try {
    await voidPayment(props.detail.id);
    message("付款已废除", { type: "success" });
    emit("refresh");
  } finally {
    voiding.value = false;
  }
};

const onReactivatePayment = async () => {
  if (!isSuperAdmin.value || props.detail?.status !== "cancelled") {
    return;
  }
  try {
    await ElMessageBox.confirm(
      "确认重新激活该付款申请？激活后将恢复为草稿状态，可重新编辑并提审。",
      "重新激活付款",
      {
        confirmButtonText: "确认激活",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
  } catch {
    return;
  }

  reactivating.value = true;
  try {
    await reactivatePayment(props.detail.id);
    message("付款已重新激活", { type: "success" });
    emit("refresh");
  } finally {
    reactivating.value = false;
  }
};

watch(
  () => props.detail,
  d => {
    if (!d) return;
    payoutForm.value = {
      payment_entity_id:
        d.payment_entity_id ?? selectedContract.value?.entity_id ?? undefined,
      payment_entity_bank_account_id:
        d.payment_entity_bank_account_id ?? undefined,
      payment_account: d.payment_account ?? ""
    };
    if (
      payoutForm.value.payment_entity_id &&
      !payoutForm.value.payment_entity_bank_account_id
    ) {
      const accounts =
        props.entityBankAccountMap[payoutForm.value.payment_entity_id]?.filter(
          item => item.status === "active"
        ) ?? [];
      if (accounts.length > 0) {
        payoutForm.value.payment_entity_bank_account_id = accounts[0].id;
        if (!payoutForm.value.payment_account) {
          payoutForm.value.payment_account = `${accounts[0].bank_name} / ${accounts[0].account_no}`;
        }
      }
    }
  },
  { immediate: true }
);
</script>

<template>
  <FinSection title="付款执行">
    <div v-if="hasPayoutActions" style="margin-bottom: 12px">
      <el-button
        type="primary"
        plain
        :disabled="detail?.status !== 'approved'"
        @click="onMarkPaid"
      >
        标记付款
      </el-button>
      <el-button
        v-if="isSuperAdmin"
        type="danger"
        plain
        :loading="voiding"
        :disabled="detail?.status === 'cancelled'"
        @click="onVoidPayment"
      >
        废除付款
      </el-button>
      <el-button
        v-if="isSuperAdmin"
        type="primary"
        plain
        :loading="reactivating"
        :disabled="detail?.status !== 'cancelled'"
        @click="onReactivatePayment"
      >
        重新激活
      </el-button>
    </div>
    <div
      v-else-if="detail && !canAdjustPayoutInApproval && !detail.paid_at"
      class="payout-empty"
    >
      当前状态无可执行的付款动作
    </div>

    <el-descriptions
      v-if="detail?.paid_at"
      :column="3"
      border
      style="margin-bottom: 12px"
    >
      <el-descriptions-item label="支付日期">
        {{ formatBeijingDateTime(detail.paid_at) }}
      </el-descriptions-item>
      <el-descriptions-item label="支付流水号">
        {{ detail.payment_reference || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="付款账户">
        {{ detail.payment_account || "-" }}
      </el-descriptions-item>
    </el-descriptions>

    <div v-if="canAdjustPayoutInApproval" class="payout-adjust">
      <div class="payout-adjust__title">审批操作区 - 付款主体与账户调整</div>
      <el-form inline>
        <el-form-item label="付款主体">
          <el-select
            v-model="payoutForm.payment_entity_id"
            clearable
            filterable
            style="width: 260px"
            @change="onPayoutEntityChange"
          >
            <el-option
              v-for="item in entities"
              :key="item.id"
              :label="item.entity_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="付款账户">
          <el-select
            v-model="payoutForm.payment_entity_bank_account_id"
            clearable
            filterable
            style="width: 360px"
            @change="onPayoutAccountChange"
          >
            <el-option
              v-for="item in payoutEntityAccounts"
              :key="item.id"
              :label="`${item.bank_name} / ${item.account_no}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="payoutSaving"
            @click="savePayoutSelection"
            >保存出纳账户选择</el-button
          >
        </el-form-item>
      </el-form>
      <div class="payout-adjust__hint">
        当前选择：{{ payoutEntity?.entity_name || "-" }} /
        {{ payoutForm.payment_account || "-" }}
      </div>
    </div>
  </FinSection>

  <el-dialog
    v-model="paidDialogVisible"
    title="登记付款执行信息"
    width="560px"
    append-to-body
  >
    <el-form label-width="120px">
      <el-form-item label="支付日期">
        <el-date-picker
          v-model="paidForm.paid_at"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="支付流水号">
        <el-input
          v-model="paidForm.payment_reference"
          placeholder="例如网银流水号"
        />
      </el-form-item>
      <el-form-item label="付款账户">
        <el-input
          v-model="paidForm.payment_account"
          placeholder="例如 建行-XX支行-1234"
        />
      </el-form-item>
      <el-form-item label="付款备注">
        <el-input v-model="paidForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="paidDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="paidSubmitting"
        @click="confirmMarkPaid"
        >确认标记</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.payout-empty {
  margin-bottom: 12px;
  font-size: 13px;
  color: #9a917f;
}

.payout-adjust {
  padding: 12px;
  margin-bottom: 12px;
  background: #fdf8ee;
  border: 1px dashed #e3d5b8;
  border-radius: 8px;
}

.payout-adjust__title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #6b4f2a;
}

.payout-adjust__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #8c6a2f;
}
</style>
