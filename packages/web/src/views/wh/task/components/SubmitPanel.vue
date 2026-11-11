<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { SubmitTaskInput } from "@/api/wh/task";
import type { TaskKind, TaskSystem } from "@/api/wh/types";
import { TASK_SYSTEM_LABELS } from "../../shared/labels";

const props = defineProps<{
  kind: TaskKind;
  taskId: number;
  missingPhotos: number;
  busy: boolean;
}>();
const emit = defineEmits<{
  submit: [data: Omit<SubmitTaskInput, "version">];
}>();

const SYSTEMS = Object.entries(TASK_SYSTEM_LABELS) as [TaskSystem, string][];
const result = ref<"pass" | "fail" | "">("");
const systems = ref<TaskSystem[]>([]);
const note = ref("");

// 换了一条任务就清空，免得把上一条没提交的内容带过去
watch(
  () => props.taskId,
  () => {
    result.value = "";
    systems.value = [];
    note.value = "";
  }
);

const blocker = computed(() => {
  if (props.kind === "inspection" && !result.value) return "请选择合格或不合格";
  if (props.kind === "maintenance" && systems.value.length === 0)
    return "请勾选维修涉及的系统";
  if (!note.value.trim()) return "请写简报";
  return "";
});

const submit = () => {
  if (blocker.value) return;
  emit("submit", {
    result_note: note.value.trim(),
    ...(props.kind === "inspection" && result.value
      ? { result: result.value }
      : {}),
    ...(props.kind === "maintenance" ? { systems: systems.value } : {})
  });
};
</script>

<template>
  <div class="submit-panel">
    <div class="title">提交结果</div>
    <el-form label-width="80px">
      <el-form-item v-if="props.kind === 'inspection'" label="检查结果">
        <el-radio-group v-model="result">
          <el-radio-button value="pass">合格</el-radio-button>
          <el-radio-button value="fail">不合格</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="props.kind === 'maintenance'" label="涉及系统">
        <el-checkbox-group v-model="systems">
          <el-checkbox
            v-for="[value, label] in SYSTEMS"
            :key="value"
            :value="value"
            >{{ label }}</el-checkbox
          >
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="简报">
        <el-input
          v-model="note"
          type="textarea"
          :rows="3"
          maxlength="800"
          placeholder="做了什么、发现了什么"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="props.busy" @click="submit"
          >提交</el-button
        >
        <span v-if="blocker" class="hint">{{ blocker }}</span>
        <span v-else-if="props.missingPhotos > 0" class="hint warn"
          >还差 {{ props.missingPhotos }} 张照片</span
        >
      </el-form-item>
    </el-form>
  </div>
</template>

<style scoped>
.submit-panel {
  padding: 12px;
  margin-top: 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.title {
  margin-bottom: 8px;
  font-weight: 600;
}

.hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.warn {
  color: var(--el-color-warning);
}
</style>
