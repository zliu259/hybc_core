<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { FlowNodeData } from "./types";

const props = defineProps<{
  node: FlowNodeData;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  update: [FlowNodeData];
}>();

const form = reactive<FlowNodeData>({
  key: "",
  type: "sequential",
  name: "",
  assignees: [],
  autoAction: "approve",
  aiSlotId: "",
  timeoutHours: undefined
});

const assigneeText = computed({
  get: () => form.assignees.join(","),
  set: (value: string) => {
    form.assignees = value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }
});

const isApprovalType = computed(() => {
  return ["sequential", "countersign", "or_sign"].includes(form.type);
});

watch(
  () => props.node,
  node => {
    form.key = node.key;
    form.type = node.type;
    form.name = node.name;
    form.assignees = [...node.assignees];
    form.autoAction = node.autoAction;
    form.aiSlotId = node.aiSlotId;
    form.timeoutHours = node.timeoutHours;
  },
  { immediate: true, deep: true }
);

watch(
  form,
  () => {
    emit("update", {
      key: form.key,
      type: form.type,
      name: form.name,
      assignees: [...form.assignees],
      autoAction: form.autoAction,
      aiSlotId: form.aiSlotId,
      timeoutHours: form.timeoutHours
    });
  },
  { deep: true }
);
</script>

<template>
  <div class="node-config-panel">
    <div class="panel-title">节点配置</div>
    <el-form
      label-position="top"
      size="small"
      class="panel-form"
      :disabled="readonly"
    >
      <el-form-item label="节点名称">
        <el-input v-model="form.name" maxlength="32" show-word-limit />
      </el-form-item>

      <el-form-item
        v-if="isApprovalType || form.type === 'cc'"
        label="审批人/抄送人userid"
      >
        <el-input
          v-model="assigneeText"
          placeholder="多个值用英文逗号分隔"
          type="textarea"
          :rows="2"
        />
      </el-form-item>

      <el-form-item v-if="form.type === 'auto'" label="自动动作">
        <el-select v-model="form.autoAction" placeholder="请选择自动动作">
          <el-option label="approve" value="approve" />
          <el-option label="reject" value="reject" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="form.type === 'ai_gate'" label="AI Slot ID">
        <el-input v-model="form.aiSlotId" placeholder="例如: payment-risk-v1" />
      </el-form-item>

      <el-form-item label="超时时间(小时)">
        <el-input-number
          v-model="form.timeoutHours"
          :min="1"
          :max="720"
          :precision="0"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.node-config-panel {
  height: 100%;
  padding: 16px;
  background: #fffaf2;
}

.panel-title {
  margin-bottom: 12px;
  color: #2a241d;
  font-size: 15px;
  font-weight: 600;
}

.panel-form :deep(.el-form-item) {
  margin-bottom: 12px;
}
</style>
