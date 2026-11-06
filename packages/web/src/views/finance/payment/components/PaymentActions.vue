<script setup lang="ts">
/** 付款单的流程操作，集中放在页面头部。只显示当前能用的按钮，不摆灰按钮。 */
import { ElMessageBox, type MessageBoxData } from "element-plus";
import { computed, ref } from "vue";
import {
  reactivatePayment,
  submitPaymentApproval,
  triggerRiskAssessment,
  voidPayment,
  type PaymentRequestDetail
} from "@/api/payment";
import type { WeComUser } from "@/api/wecom";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import ApprovalSubmitDialog from "../../shared/components/ApprovalSubmitDialog.vue";
import type { PaymentCapabilities } from "../payment-detail-view";
import PaymentMarkPaidDialog from "./PaymentMarkPaidDialog.vue";

defineOptions({ name: "PaymentActions" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  capabilities: PaymentCapabilities;
  wecomUsers: WeComUser[];
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const NOTE_TEMPLATES = [
  "请优先审批，业务节点加急。",
  "付款凭证已补齐，请审核通过。",
  "金额与收款信息已复核，请确认。",
  "请关注付款时效，审批完成后将立即执行打款。"
];

const defaultSummary = computed(() => {
  const { detail } = props;
  return detail?.serial_no
    ? `${detail.serial_no} | ${detail.content} | ${detail.amount}`
    : "";
});

const submitApproval = (
  payload: Parameters<typeof submitPaymentApproval>[1],
  options: { idempotencyKey: string }
) => submitPaymentApproval(props.detail?.id ?? 0, payload, options);

const submitVisible = ref(false);
const markPaidVisible = ref(false);
const pending = ref<"" | "risk" | "void" | "reactivate">("");

const confirmed = async (
  content: string,
  title: string,
  confirmButtonText: string
): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(content, title, {
      confirmButtonText,
      cancelButtonText: "取消",
      type: "warning"
    });
    return true;
  } catch {
    return false;
  }
};

const run = async (
  key: "risk" | "void" | "reactivate",
  work: (id: number) => Promise<unknown>,
  doneText: string,
  failText: string
) => {
  const id = props.detail?.id;
  if (!id) return;
  pending.value = key;
  try {
    await work(id);
    message(doneText, { type: "success" });
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, failText), { type: "error" });
  } finally {
    pending.value = "";
  }
};

const onAssessRisk = () =>
  run("risk", triggerRiskAssessment, "已触发风险评估", "触发风险评估失败");

const onVoid = async () => {
  let reason = "";
  try {
    const result = await ElMessageBox.prompt(
      "废除后将不再出现在付款列表中。原因会显示在付款详情和审批详情里。",
      "废除付款",
      {
        confirmButtonText: "确认废除",
        cancelButtonText: "取消",
        type: "warning",
        inputPlaceholder: "请填写废除原因",
        inputValidator: value => Boolean(value?.trim()) || "请填写废除原因"
      }
    );
    reason = (result as Exclude<MessageBoxData, string>).value.trim();
  } catch {
    return;
  }
  await run(
    "void",
    id => voidPayment(id, { reason }),
    "付款已废除",
    "废除失败"
  );
};

const onReactivate = async () => {
  const ok = await confirmed(
    "确认重新激活该付款申请？激活后将恢复为草稿状态，可重新编辑并提审。",
    "重新激活付款",
    "确认激活"
  );
  if (ok) {
    await run(
      "reactivate",
      reactivatePayment,
      "付款已重新激活",
      "重新激活失败"
    );
  }
};
</script>

<template>
  <el-button
    v-if="capabilities.canVoid"
    type="danger"
    plain
    :loading="pending === 'void'"
    @click="onVoid"
  >
    废除付款
  </el-button>
  <el-button
    v-if="capabilities.canReactivate"
    type="primary"
    plain
    :loading="pending === 'reactivate'"
    @click="onReactivate"
  >
    重新激活
  </el-button>
  <el-button
    v-if="capabilities.canAssessRisk"
    :loading="pending === 'risk'"
    @click="onAssessRisk"
  >
    触发风险评估
  </el-button>
  <el-button
    v-if="capabilities.canSubmit"
    type="primary"
    @click="submitVisible = true"
  >
    提交审批
  </el-button>
  <el-button
    v-if="capabilities.canMarkPaid"
    type="primary"
    @click="markPaidVisible = true"
  >
    标记付款
  </el-button>

  <ApprovalSubmitDialog
    v-model:visible="submitVisible"
    :biz-id="detail?.id ?? null"
    scope="payment-detail-submit"
    :default-summary="defaultSummary"
    :note-templates="NOTE_TEMPLATES"
    :wecom-users="wecomUsers"
    :submit="submitApproval"
    @submitted="emit('refresh')"
  />
  <PaymentMarkPaidDialog
    v-model:visible="markPaidVisible"
    :detail="detail"
    @paid="emit('refresh')"
  />
</template>
