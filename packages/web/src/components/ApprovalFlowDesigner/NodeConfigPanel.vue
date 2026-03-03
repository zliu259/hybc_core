<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { listAiSlotOptions } from "@/api/admin";
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
const syncingFromProps = ref(false);
let emitTimer: ReturnType<typeof setTimeout> | null = null;
const lastEmittedSignature = ref("");

const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const usersLoaded = ref(wecomUsers.value.length > 0);
const usersLoading = ref(false);
const aiSlotsLoaded = ref(false);
const aiSlotsLoading = ref(false);
const aiSlotOptionsRaw = ref<Array<{ slot_id: string; label: string }>>([]);

const assigneeOptions = computed(() => {
  const mapped = wecomUsers.value.map(user => ({
    value: user.userid,
    label: user.name ? `${user.name} (${user.userid})` : user.userid
  }));

  const existing = new Set(mapped.map(item => item.value));
  for (const userid of form.assignees) {
    if (!existing.has(userid)) {
      mapped.push({ value: userid, label: userid });
      existing.add(userid);
    }
  }
  return mapped;
});

const isApprovalType = computed(() => {
  return ["sequential", "countersign", "or_sign"].includes(form.type);
});

const aiSlotOptions = computed(() => {
  const options = aiSlotOptionsRaw.value.map(item => ({
    value: item.slot_id,
    label: item.label
  }));

  if (form.aiSlotId && !options.some(item => item.value === form.aiSlotId)) {
    options.push({ value: form.aiSlotId, label: form.aiSlotId });
  }

  return options;
});

watch(
  () => props.node,
  node => {
    syncingFromProps.value = true;
    form.key = node.key;
    form.type = node.type;
    form.name = node.name;
    form.assignees = [...node.assignees];
    form.autoAction = node.autoAction;
    form.aiSlotId = node.aiSlotId;
    form.timeoutHours = node.timeoutHours;
    syncingFromProps.value = false;
  },
  { immediate: true }
);

const scheduleEmitUpdate = () => {
  if (syncingFromProps.value) {
    return;
  }

  const payload: FlowNodeData = {
    key: form.key,
    type: form.type,
    name: form.name,
    assignees: [...form.assignees],
    autoAction: form.autoAction,
    aiSlotId: form.aiSlotId,
    timeoutHours: form.timeoutHours
  };
  const signature = JSON.stringify(payload);
  if (signature === lastEmittedSignature.value) {
    return;
  }

  if (emitTimer) {
    clearTimeout(emitTimer);
  }
  emitTimer = setTimeout(() => {
    emitTimer = null;
    if (syncingFromProps.value) {
      return;
    }
    lastEmittedSignature.value = signature;
    emit("update", payload);
  }, 60);
};

watch(
  () => [
    form.key,
    form.type,
    form.name,
    form.autoAction,
    form.aiSlotId,
    form.timeoutHours,
    form.assignees.join("|")
  ],
  () => {
    scheduleEmitUpdate();
  }
);

const ensureWecomUsersLoaded = async () => {
  if (usersLoaded.value || usersLoading.value) {
    return;
  }

  usersLoading.value = true;
  try {
    await loadWecomUsers();
    usersLoaded.value = true;
  } catch {
    // keep cached options only when remote load fails
  } finally {
    usersLoading.value = false;
  }
};

const ensureAiSlotOptionsLoaded = async () => {
  if (aiSlotsLoaded.value || aiSlotsLoading.value) {
    return;
  }

  aiSlotsLoading.value = true;
  try {
    const result = await listAiSlotOptions();
    aiSlotOptionsRaw.value = result.data.map(item => ({
      slot_id: item.slot_id,
      label: item.label
    }));
    aiSlotsLoaded.value = true;
  } catch {
    // keep manual fallback entry only
  } finally {
    aiSlotsLoading.value = false;
  }
};

onBeforeUnmount(() => {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
});
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
        <el-select-v2
          v-model="form.assignees"
          :options="assigneeOptions"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          clearable
          :loading="usersLoading"
          placeholder="请选择人员"
          style="width: 100%"
          @visible-change="visible => visible && ensureWecomUsersLoaded()"
        />
      </el-form-item>

      <el-form-item v-if="form.type === 'auto'" label="自动动作">
        <el-select v-model="form.autoAction" placeholder="请选择自动动作">
          <el-option label="approve" value="approve" />
          <el-option label="reject" value="reject" />
        </el-select>
      </el-form-item>

      <el-form-item v-if="form.type === 'ai_gate'" label="AI Slot ID">
        <el-select
          v-model="form.aiSlotId"
          filterable
          allow-create
          default-first-option
          clearable
          :loading="aiSlotsLoading"
          placeholder="请选择或输入AI Slot"
          style="width: 100%"
          @visible-change="visible => visible && ensureAiSlotOptionsLoaded()"
        >
          <el-option
            v-for="item in aiSlotOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
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
