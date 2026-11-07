<script setup lang="ts">
import { computed, ref } from "vue";

import type { ActionDialogKind } from "./view-model";

// 需要填内容的操作共用一个弹窗。复核通过的放行理由还是原来的提示框，在 usePrecheckActions 里。

type DialogConfig = {
  title: string;
  confirm: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  noInput?: boolean;
  danger?: boolean;
};

const CONFIGS: Record<ActionDialogKind, DialogConfig> = {
  verify: {
    title: "核查签收",
    confirm: "核查签收",
    placeholder: "核查备注（可选）"
  },
  mark_mismatch: {
    title: "标记异常",
    confirm: "标记异常",
    placeholder: "写明发现了什么问题，申请人会看到这段话",
    required: true
  },
  precheck_supplement: {
    title: "要求补充",
    confirm: "要求补充",
    placeholder: "写明要补充什么，申请人会看到这段话",
    required: true
  },
  precheck_reject: {
    title: "驳回",
    confirm: "驳回",
    placeholder: "写明驳回原因，申请人会看到这段话",
    required: true,
    danger: true
  },
  void: {
    title: "废止这张报销",
    confirm: "废止",
    description: "废止后不再流转。",
    placeholder: "废止原因（必填），不超过 200 字",
    required: true,
    danger: true
  },
  rebind: {
    title: "换绑信封",
    confirm: "确认换绑",
    placeholder: "换绑原因（可选）"
  },
  rerun_all: {
    title: "全部重新识别",
    confirm: "开始识别",
    description: "会重新识别全部附件，已有结论清空，复核状态回到待复核。",
    noInput: true
  }
};

defineProps<{ busy: boolean }>();

const emit = defineEmits<{
  (
    event: "confirm",
    payload: { kind: ActionDialogKind; value: string; uuid: string }
  ): void;
}>();

const visible = ref(false);
const kind = ref<ActionDialogKind>("verify");
const value = ref("");
const uuid = ref("");

const config = computed(() => CONFIGS[kind.value]);
const canConfirm = computed(() => {
  if (kind.value === "rebind" && !uuid.value.trim()) return false;
  return !config.value.required || Boolean(value.value.trim());
});

const open = (nextKind: ActionDialogKind) => {
  kind.value = nextKind;
  value.value = "";
  uuid.value = "";
  visible.value = true;
};

const close = () => {
  visible.value = false;
};

defineExpose({ open, close });

const onConfirm = () => {
  if (!canConfirm.value) return;
  emit("confirm", {
    kind: kind.value,
    value: value.value.trim(),
    uuid: uuid.value.trim()
  });
  visible.value = false;
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="config.title"
    width="min(480px, 92vw)"
    append-to-body
  >
    <p v-if="config.description" class="rb-dialog-text">
      {{ config.description }}
    </p>
    <el-input
      v-if="kind === 'rebind'"
      v-model="uuid"
      class="rb-dialog-field"
      placeholder="输入正确的实体信封识别号"
    />
    <el-input
      v-if="!config.noInput"
      v-model="value"
      type="textarea"
      :rows="3"
      maxlength="200"
      show-word-limit
      :placeholder="config.placeholder"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        :type="config.danger ? 'danger' : 'primary'"
        :loading="busy"
        :disabled="!canConfirm"
        @click="onConfirm"
      >
        {{ config.confirm }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rb-dialog-text {
  margin: 0 0 12px;
  line-height: 22px;
  color: #5c667a;
}

.rb-dialog-field {
  margin-bottom: 12px;
}
</style>
