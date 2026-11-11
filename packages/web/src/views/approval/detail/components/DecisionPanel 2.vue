<script setup lang="ts">
/**
 * 决策面板。「通过」是主路径：不写意见也能一键通过（记为「同意」）；驳回、退回需要
 * 写清原因；转办、撤回等低频操作收进「更多」，避免七个按钮平铺。
 */
import { computed, nextTick, ref, watch } from "vue";
import type { Entity } from "@/api/entity";
import { PAYOUT_METHOD_OPTIONS, type PayoutPlan } from "../usePayoutPlan";
import type { ApprovalActions } from "../useApprovalActions";
import { toPaymentMethodLabel } from "../formatters";
import ApprovalPanel from "./ApprovalPanel.vue";

defineOptions({ name: "DecisionPanel" });

const props = defineProps<{
  availableActions: string[];
  actions: ApprovalActions;
  payout: PayoutPlan;
  entities: Entity[];
}>();

const emit = defineEmits<{ return: []; transfer: [] }>();

const QUICK_COMMENTS = ["同意", "情况属实", "请补充材料", "金额需再核对"];

const has = (action: string) => props.availableActions.includes(action);
const canDecide = computed(() => has("approve") || has("reject"));
const canReturn = computed(
  () => has("return_initiator") || has("return_prev") || has("return_to")
);
const moreActions = computed(() =>
  [
    { key: "transfer", label: "转办给其他人", show: has("transfer") },
    { key: "withdraw", label: "撤回", show: has("withdraw") },
    {
      key: "cancel",
      label: props.actions.cancelLabel.value,
      show: has("cancel")
    }
  ].filter(item => item.show)
);

const comment = computed({
  get: () => props.actions.comment.value,
  set: value => props.actions.setComment(value)
});

const commentInput = ref<{ focus: () => void } | null>(null);
watch(
  () => props.actions.commentError.value,
  async error => {
    if (!error) return;
    await nextTick();
    commentInput.value?.focus();
  }
);

const onMore = (key: string) => {
  if (key === "transfer") emit("transfer");
  if (key === "withdraw") void props.actions.withdraw();
  if (key === "cancel") void props.actions.cancel();
};

const form = computed(() => props.payout.form.value);
const payoutSummary = computed(() => {
  const parts = [
    form.value.payment_method
      ? toPaymentMethodLabel(form.value.payment_method)
      : "",
    props.payout.entityName.value,
    form.value.payment_account
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("，") : "尚未选择";
});
</script>

<template>
  <ApprovalPanel class="decision-panel" title="你的审批">
    <div v-if="payout.visible.value" class="decision-panel__payout">
      <div class="decision-panel__payout-head">
        <span class="decision-panel__payout-label">支付方案</span>
        <el-button
          link
          type="primary"
          size="small"
          @click="actions.togglePayoutEditor"
        >
          {{ actions.payoutEditorOpen.value ? "收起" : "修改" }}
        </el-button>
      </div>
      <p
        v-if="!actions.payoutEditorOpen.value"
        class="decision-panel__payout-text"
      >
        {{ payoutSummary }}
      </p>
      <el-form v-else label-position="top" size="small">
        <el-form-item label="支付方式">
          <el-select
            :model-value="form.payment_method"
            placeholder="选择支付方式"
            @update:model-value="payout.setMethod"
          >
            <el-option
              v-for="item in PAYOUT_METHOD_OPTIONS"
              :key="item.value || 'empty'"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="付款主体">
          <el-select
            :model-value="form.payment_entity_id"
            filterable
            clearable
            placeholder="选择付款主体"
            @update:model-value="payout.onEntityChange"
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
            :model-value="form.payment_entity_bank_account_id"
            filterable
            clearable
            :loading="payout.accountsLoading.value"
            placeholder="选择付款账户"
            @update:model-value="payout.onAccountChange"
          >
            <el-option
              v-for="item in payout.entityAccounts.value"
              :key="item.id"
              :label="`${item.bank_name} / ${item.account_no}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="payout.titleMismatch.value"
          type="error"
          :closable="false"
          :title="`与发票抬头主体（${payout.titleEntityName.value}）不一致`"
          class="decision-panel__mismatch"
        />
        <el-button
          size="small"
          :disabled="actions.busy.value || !payout.dirty.value"
          :loading="actions.pendingAction.value === 'save_payout'"
          @click="actions.savePayout"
        >
          保存支付方案
        </el-button>
      </el-form>
    </div>

    <template v-if="canDecide">
      <el-input
        ref="commentInput"
        v-model="comment"
        type="textarea"
        :rows="3"
        resize="none"
        :class="{ 'is-error': actions.commentError.value }"
        placeholder="审批意见（通过时可不填，默认记为「同意」）"
      />
      <p v-if="actions.commentError.value" class="decision-panel__error">
        {{ actions.commentError.value }}
      </p>
      <div class="decision-panel__quick">
        <button
          v-for="text in QUICK_COMMENTS"
          :key="text"
          type="button"
          @click="comment = text"
        >
          {{ text }}
        </button>
      </div>
    </template>

    <div class="decision-panel__actions">
      <el-button
        v-if="has('approve')"
        type="primary"
        size="large"
        class="decision-panel__approve"
        :disabled="actions.busy.value"
        :loading="actions.pendingAction.value === 'approve'"
        @click="actions.approve"
      >
        通过
      </el-button>
      <el-button
        v-if="has('resubmit')"
        type="primary"
        size="large"
        class="decision-panel__approve"
        :disabled="actions.busy.value"
        :loading="actions.pendingAction.value === 'resubmit'"
        @click="actions.resubmit"
      >
        重新提交
      </el-button>
      <div class="decision-panel__secondary">
        <el-button
          v-if="canReturn"
          :disabled="actions.busy.value"
          :loading="actions.pendingAction.value === 'return'"
          @click="emit('return')"
        >
          退回
        </el-button>
        <el-button
          v-if="has('reject')"
          type="danger"
          plain
          :disabled="actions.busy.value"
          :loading="actions.pendingAction.value === 'reject'"
          @click="actions.reject"
        >
          驳回
        </el-button>
        <el-dropdown
          v-if="moreActions.length > 0"
          trigger="click"
          :disabled="actions.busy.value"
          @command="onMore"
        >
          <el-button
            :loading="
              actions.pendingAction.value === 'withdraw' ||
              actions.pendingAction.value === 'cancel' ||
              actions.pendingAction.value === 'transfer'
            "
          >
            更多
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="item in moreActions"
                :key="item.key"
                :command="item.key"
              >
                {{ item.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </ApprovalPanel>
</template>

<style scoped>
.decision-panel {
  border-color: var(--el-color-primary-light-5);
}

.decision-panel__payout {
  padding: 8px 10px;
  margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}

.decision-panel__payout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.decision-panel__payout-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.decision-panel__payout-text {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.decision-panel__mismatch {
  margin-bottom: 10px;
}

.decision-panel__error {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}

.decision-panel__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.decision-panel__quick button {
  padding: 2px 8px;
  font: inherit;
  font-size: 12px;
  line-height: 20px;
  color: var(--el-text-color-regular);
  cursor: pointer;
  background: var(--el-fill-color-light);
  border: none;
  border-radius: 4px;
}

.decision-panel__quick button:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.decision-panel__quick button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.decision-panel__actions {
  margin-top: 12px;
}

.decision-panel__approve {
  width: 100%;
  margin-left: 0;
}

.decision-panel__secondary {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.decision-panel__secondary:empty {
  display: none;
}

.decision-panel__secondary :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}

.decision-panel__secondary > * {
  flex: 1;
}

.is-error :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}
</style>
