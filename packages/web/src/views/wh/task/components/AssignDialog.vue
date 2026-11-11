<script setup lang="ts">
import { ref, watch } from "vue";

import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

const props = defineProps<{ current: string | null; busy: boolean }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ confirm: [userid: string] }>();

const { wecomUsers, loadUserNames } = useWecomUserOptions();
const userid = ref("");

watch(visible, open => {
  if (!open) return;
  userid.value = props.current ?? "";
  void loadUserNames();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="props.current ? '改派' : '派工'"
    width="420px"
    append-to-body
  >
    <el-select
      v-model="userid"
      filterable
      placeholder="选择执行人"
      style="width: 100%"
    >
      <el-option
        v-for="user in wecomUsers"
        :key="user.userid"
        :label="user.name"
        :value="user.userid"
      />
    </el-select>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="props.busy"
        :disabled="!userid || userid === props.current"
        @click="emit('confirm', userid)"
        >确定</el-button
      >
    </template>
  </el-dialog>
</template>
