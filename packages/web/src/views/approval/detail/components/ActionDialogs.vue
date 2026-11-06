<script setup lang="ts">
/** 退回、转办、强制改派三个弹窗。打开时重置表单，退回意见沿用面板里已写的内容。 */
import { computed, ref, watch } from "vue";
import type { ApprovalNodeInstance, ApprovalTask } from "@/api/approval";
import type { WeComUser } from "@/api/wecom";
import { message } from "@/utils/message";
import type { ReturnPayload } from "../useApprovalActions";

defineOptions({ name: "ActionDialogs" });

const returnVisible = defineModel<boolean>("returnVisible", { required: true });
const transferVisible = defineModel<boolean>("transferVisible", {
  required: true
});
const forceTask = defineModel<ApprovalTask | null>("forceTask", {
  required: true
});

const props = defineProps<{
  availableActions: string[];
  nodes: ApprovalNodeInstance[];
  currentRound: number;
  users: WeComUser[];
  defaultComment: string;
  pendingAction: string | null;
  toUserLabel: (userid: string | null | undefined) => string;
}>();

const emit = defineEmits<{
  submitReturn: [payload: ReturnPayload];
  submitTransfer: [toUserid: string, reason: string];
  submitForceTransfer: [taskId: number, toUserid: string, reason: string];
}>();

const RETURN_OPTIONS: Array<{
  value: ReturnPayload["type"];
  action: string;
  label: string;
}> = [
  { value: "initiator", action: "return_initiator", label: "退回发起人" },
  { value: "prev", action: "return_prev", label: "退回上一步" },
  { value: "to", action: "return_to", label: "退回指定节点" }
];

const returnOptions = computed(() =>
  RETURN_OPTIONS.filter(item => props.availableActions.includes(item.action))
);
const returnTargets = computed(() =>
  props.nodes.filter(
    node => node.round === props.currentRound && node.status === "completed"
  )
);

const returnType = ref<ReturnPayload["type"]>("initiator");
const returnTarget = ref("");
const returnComment = ref("");
watch(returnVisible, open => {
  if (!open) return;
  returnType.value = returnOptions.value[0]?.value ?? "initiator";
  returnTarget.value = "";
  returnComment.value = props.defaultComment;
});

const onReturn = () => {
  if (returnType.value === "to" && !returnTarget.value) {
    message("请选择退回到哪个节点", { type: "warning" });
    return;
  }
  returnVisible.value = false;
  emit("submitReturn", {
    type: returnType.value,
    target_node_key: returnType.value === "to" ? returnTarget.value : undefined,
    comment: returnComment.value.trim() || undefined
  });
};

const transferTo = ref("");
const transferReason = ref("");
watch(transferVisible, open => {
  if (!open) return;
  transferTo.value = "";
  transferReason.value = "";
});

const onTransfer = () => {
  if (!transferTo.value || !transferReason.value.trim()) {
    message("请选择转办人并写明原因", { type: "warning" });
    return;
  }
  transferVisible.value = false;
  emit("submitTransfer", transferTo.value, transferReason.value.trim());
};

const forceVisible = computed({
  get: () => forceTask.value !== null,
  set: open => {
    if (!open) forceTask.value = null;
  }
});
const forceTo = ref("");
const forceReason = ref("");
watch(forceTask, task => {
  if (!task) return;
  forceTo.value = "";
  forceReason.value = "";
});

const onForceTransfer = () => {
  const task = forceTask.value;
  if (!task) return;
  if (!forceTo.value || !forceReason.value.trim()) {
    message("请选择改派给谁并写明原因", { type: "warning" });
    return;
  }
  if (forceTo.value === task.assignee_userid) {
    message("改派对象与当前审批人相同", { type: "warning" });
    return;
  }
  forceTask.value = null;
  emit("submitForceTransfer", task.id, forceTo.value, forceReason.value.trim());
};
</script>

<template>
  <el-dialog v-model="returnVisible" title="退回审批" width="480px">
    <el-form label-width="80px">
      <el-form-item label="退回方式">
        <el-radio-group v-model="returnType">
          <el-radio
            v-for="item in returnOptions"
            :key="item.value"
            :value="item.value"
          >
            {{ item.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="returnType === 'to'" label="目标节点">
        <el-select v-model="returnTarget" placeholder="选择节点">
          <el-option
            v-for="node in returnTargets"
            :key="node.node_key"
            :label="node.node_name"
            :value="node.node_key"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="退回意见">
        <el-input
          v-model="returnComment"
          type="textarea"
          :rows="3"
          placeholder="说明需要对方修改什么"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="returnVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="pendingAction === 'return'"
        @click="onReturn"
      >
        确定退回
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="transferVisible" title="转办审批" width="480px">
    <el-form label-width="80px">
      <el-form-item label="转办给">
        <el-select
          v-model="transferTo"
          clearable
          filterable
          placeholder="选择公司人员"
        >
          <el-option
            v-for="item in users"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="转办原因">
        <el-input v-model="transferReason" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="transferVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="pendingAction === 'transfer'"
        @click="onTransfer"
      >
        确定转办
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="forceVisible" title="强制改派审批人" width="520px">
    <el-alert
      type="warning"
      :closable="false"
      title="当前待审批任务会直接换人，并留下超管改派记录。"
      class="action-dialogs__alert"
    />
    <el-form label-width="96px">
      <el-form-item label="当前审批人">
        {{ toUserLabel(forceTask?.assignee_userid) }}
      </el-form-item>
      <el-form-item label="改派给">
        <el-select
          v-model="forceTo"
          clearable
          filterable
          placeholder="选择公司人员"
        >
          <el-option
            v-for="item in users"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="改派原因">
        <el-input v-model="forceReason" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="forceVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="pendingAction === 'force_transfer'"
        @click="onForceTransfer"
      >
        确认改派
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.action-dialogs__alert {
  margin-bottom: 12px;
}
</style>
