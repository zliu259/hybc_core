<script setup lang="ts">
defineOptions({ name: "PaymentAdminEditPanel" });

defineProps<{ visible: boolean }>();

const editMode = defineModel<boolean>("editMode", { required: true });
const editNote = defineModel<string>("editNote", { required: true });
</script>

<template>
  <el-form v-if="visible" inline style="margin-bottom: 10px">
    <el-form-item label="超管编辑模式">
      <el-switch v-model="editMode" />
    </el-form-item>
    <el-form-item label="修改说明">
      <el-input
        v-model="editNote"
        :disabled="!editMode"
        placeholder="开启后必填，将写入备注留痕"
        style="width: 380px"
      />
    </el-form-item>
  </el-form>

  <el-alert
    v-if="visible && editMode"
    title="超管编辑模式已开启：保存业务字段时将强制要求修改说明，并把留痕写入备注。"
    type="warning"
    :closable="false"
    style="margin-bottom: 12px"
  />
</template>
