<script setup lang="ts">
/** 合同的流程操作，集中放在页面头部。只显示当前能用的按钮，不摆灰按钮。 */
import { computed, ref } from "vue";
import {
  submitContractApproval,
  triggerAiReview,
  type ContractDetail
} from "@/api/contract";
import type { WeComUser } from "@/api/wecom";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import ApprovalSubmitDialog from "../../shared/components/ApprovalSubmitDialog.vue";
import type { ContractCapabilities } from "../contract-detail-view";
import AmountChangeDrawer from "./AmountChangeDrawer.vue";

defineOptions({ name: "ContractActions" });

const props = defineProps<{
  detail: ContractDetail | null;
  capabilities: ContractCapabilities;
  wecomUsers: WeComUser[];
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const NOTE_TEMPLATES = [
  "请优先审批，业务节点加急。",
  "合同资料已补齐，请按标准流程审批。",
  "金额与条款已复核通过，请确认。",
  "附件已更新到最新版本，请以最新附件为准。"
];

const submitVisible = ref(false);
const amountChangeVisible = ref(false);
const triggering = ref(false);

const defaultSummary = computed(() => {
  const { detail } = props;
  return detail?.contract_no
    ? `${detail.contract_no} | ${detail.counterparty} | ${detail.total_amount}`
    : "";
});

const submitApproval = (
  payload: Parameters<typeof submitContractApproval>[1],
  options: { idempotencyKey: string }
) => submitContractApproval(props.detail?.id ?? 0, payload, options);

const onTriggerReview = async () => {
  const id = props.detail?.id;
  if (!id) return;
  triggering.value = true;
  try {
    await triggerAiReview(id);
    message("已触发AI审查", { type: "success" });
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "触发AI审查失败"), { type: "error" });
  } finally {
    triggering.value = false;
  }
};
</script>

<template>
  <el-button
    v-if="capabilities.canTriggerReview"
    :loading="triggering"
    @click="onTriggerReview"
  >
    触发AI审查
  </el-button>
  <el-button
    v-if="capabilities.canSubmit"
    type="primary"
    @click="submitVisible = true"
  >
    提交审批
  </el-button>
  <el-button
    v-if="capabilities.canRequestAmountChange"
    type="primary"
    plain
    @click="amountChangeVisible = true"
  >
    发起金额变更
  </el-button>

  <ApprovalSubmitDialog
    v-model:visible="submitVisible"
    :biz-id="detail?.id ?? null"
    scope="contract-detail-submit"
    :default-summary="defaultSummary"
    :note-templates="NOTE_TEMPLATES"
    :wecom-users="wecomUsers"
    :submit="submitApproval"
    @submitted="emit('refresh')"
  />
  <AmountChangeDrawer
    v-model:visible="amountChangeVisible"
    :contract="detail"
    note="合同金额变更发起自合同详情"
    @changed="emit('refresh')"
  />
</template>
