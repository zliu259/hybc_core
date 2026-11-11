<script setup lang="ts">
import { reactive, ref, watch } from "vue";

import { createTask } from "@/api/wh/task";
import type { DeviceRow, TaskKind } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import DevicePicker from "../../doc/components/DevicePicker.vue";
import { TASK_KIND_LABELS } from "../../shared/labels";
import { useWhAction } from "../../shared/useWhAction";

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [id: number] }>();

const { busy, run } = useWhAction();
const { wecomUsers, loadUserNames } = useWecomUserOptions();
const KINDS = Object.entries(TASK_KIND_LABELS) as [TaskKind, string][];

const blank = () => ({
  kind: "inspection" as TaskKind,
  title: "",
  description: "",
  blocking: true,
  required_photo_count: 0,
  due_date: "",
  assignee_userid: ""
});
const form = reactive(blank());
const device = ref<DeviceRow | null>(null);

watch(visible, open => {
  if (!open) return;
  Object.assign(form, blank());
  device.value = null;
  void loadUserNames();
});

// 检查和维修默认挡住设备发出，保养和其他默认不挡；可以手动改
watch(
  () => form.kind,
  kind => {
    form.blocking = kind === "inspection" || kind === "maintenance";
  }
);

const submit = async () => {
  const result = await run(
    () =>
      createTask({
        kind: form.kind,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        device_id: device.value?.id ?? null,
        blocking: device.value ? form.blocking : false,
        required_photo_count: form.required_photo_count,
        due_date: form.due_date || null,
        assignee_userid: form.assignee_userid || null
      }),
    { success: "任务已创建" }
  );
  if (result) {
    visible.value = false;
    emit("created", result.data.id);
  }
};
</script>

<template>
  <el-dialog v-model="visible" title="新建任务" width="560px">
    <el-form label-width="90px">
      <el-form-item label="类型" required>
        <el-radio-group v-model="form.kind">
          <el-radio-button
            v-for="[value, label] in KINDS"
            :key="value"
            :value="value"
            >{{ label }}</el-radio-button
          >
        </el-radio-group>
      </el-form-item>
      <el-form-item label="标题" required>
        <el-input v-model="form.title" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item label="设备">
        <el-tag v-if="device" closable @close="device = null"
          >{{ device.device_code }} {{ device.name }}</el-tag
        >
        <DevicePicker v-else :exclude-ids="[]" @pick="device = $event" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          maxlength="500"
        />
      </el-form-item>
      <el-form-item label="挡住发出">
        <el-switch v-model="form.blocking" :disabled="!device" />
        <span class="hint">打开后，任务没完成前这台设备不能发往项目</span>
      </el-form-item>
      <el-form-item label="照片要求">
        <el-input-number
          v-model="form.required_photo_count"
          :min="0"
          :max="9"
          :step="1"
          step-strictly
        />
        <span class="hint">张，提交前必须拍够</span>
      </el-form-item>
      <el-form-item label="期限">
        <el-date-picker
          v-model="form.due_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="可不填"
        />
      </el-form-item>
      <el-form-item label="执行人">
        <el-select
          v-model="form.assignee_userid"
          filterable
          clearable
          placeholder="可以稍后再派"
        >
          <el-option
            v-for="user in wecomUsers"
            :key="user.userid"
            :label="user.name"
            :value="user.userid"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="!form.title.trim()"
        @click="submit"
        >创建</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
