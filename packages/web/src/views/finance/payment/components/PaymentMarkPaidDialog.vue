<script setup lang="ts">
import { ref, watch } from "vue";
import { listEntityBankAccounts } from "@/api/entity";
import { markPaymentPaid, type PaymentRequestDetail } from "@/api/payment";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatBeijingDateTime } from "@/utils/datetime";
import { message } from "@/utils/message";

defineOptions({ name: "PaymentMarkPaidDialog" });

const visible = defineModel<boolean>("visible", { required: true });

const props = defineProps<{ detail: PaymentRequestDetail | null }>();

const emit = defineEmits<{ (e: "paid"): void }>();

const submitting = ref(false);
const form = ref({
  paid_at: "",
  payment_reference: "",
  payment_account: "",
  remark: ""
});

/** 单据上没选账户时，用付款主体（或合同主体）的第一个启用账户预填，出纳可以改。 */
const defaultAccount = async (): Promise<string> => {
  const { detail } = props;
  if (detail?.payment_account) return detail.payment_account;
  const entityId = detail?.payment_entity_id ?? detail?.contract?.entity_id;
  if (!entityId) return "";
  try {
    const { data } = await listEntityBankAccounts(entityId);
    const account = data.find(item => item.status === "active") ?? data[0];
    return account ? `${account.bank_name} / ${account.account_no}` : "";
  } catch {
    return "";
  }
};

watch(visible, async open => {
  if (!open) return;
  form.value = {
    // 按北京时间取当天：早上 8 点前直接截 ISO 字符串会变成昨天
    paid_at: formatBeijingDateTime(new Date().toISOString()).slice(0, 10),
    payment_reference: "",
    payment_account: props.detail?.payment_account ?? "",
    remark: ""
  };
  const account = await defaultAccount();
  if (visible.value && !form.value.payment_account) {
    form.value = { ...form.value, payment_account: account };
  }
});

const confirm = async () => {
  const id = props.detail?.id;
  if (!id) return;
  submitting.value = true;
  try {
    await markPaymentPaid(id, {
      paid_at: form.value.paid_at || undefined,
      payment_reference: form.value.payment_reference || undefined,
      payment_account: form.value.payment_account || undefined,
      remark: form.value.remark || undefined
    });
    visible.value = false;
    message("已标记为已付款", { type: "success" });
    emit("paid");
  } catch (error) {
    message(resolveApiErrorMessage(error, "标记付款失败，请重试"), {
      type: "error"
    });
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    title="登记付款执行信息"
    width="560px"
    append-to-body
  >
    <el-form label-width="120px">
      <el-form-item label="支付日期">
        <el-date-picker
          v-model="form.paid_at"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="支付流水号">
        <el-input
          v-model="form.payment_reference"
          placeholder="例如网银流水号"
        />
      </el-form-item>
      <el-form-item label="付款账户">
        <el-input
          v-model="form.payment_account"
          placeholder="例如 建行-XX支行-1234"
        />
      </el-form-item>
      <el-form-item label="付款备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="confirm">
        确认标记
      </el-button>
    </template>
  </el-dialog>
</template>
