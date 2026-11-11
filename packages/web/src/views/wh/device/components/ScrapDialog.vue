<script setup lang="ts">
import { ref, watch } from "vue";

import { uploadAttachmentFile } from "@/api/upload";
import { scrapDevice } from "@/api/wh/device";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import { newClientRequestId } from "../../shared/ids";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ deviceId: number; deviceCode: string }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ scrapped: [] }>();

const { busy, run } = useWhAction();
const reason = ref("");
const photos = ref<{ key: string; name: string }[]>([]);
const uploading = ref(false);
let requestId = newClientRequestId();

watch(visible, open => {
  if (!open) return;
  reason.value = "";
  photos.value = [];
  requestId = newClientRequestId();
});

const upload = async (options: { file: File }) => {
  uploading.value = true;
  try {
    const uploaded = await uploadAttachmentFile(options.file, "wh-doc");
    photos.value = [
      ...photos.value,
      { key: uploaded.file_key, name: uploaded.file_name }
    ];
  } catch (error) {
    message(resolveApiErrorMessage(error, "照片上传失败"), { type: "error" });
  } finally {
    uploading.value = false;
  }
};

const submit = async () => {
  const result = await run(
    () =>
      scrapDevice(props.deviceId, {
        client_request_id: requestId,
        remark: reason.value,
        photo_keys: photos.value.map(p => p.key)
      }),
    { success: "已报废" }
  );
  if (result) {
    visible.value = false;
    emit("scrapped");
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`报废 ${props.deviceCode}`"
    width="520px"
  >
    <el-alert
      title="报废后设备不能再发出。只有超级管理员可以撤销报废。"
      type="warning"
      show-icon
      :closable="false"
    />
    <el-form label-width="80px" style="margin-top: 12px">
      <el-form-item label="报废原因" required>
        <el-input v-model="reason" type="textarea" maxlength="300" :rows="3" />
      </el-form-item>
      <el-form-item label="照片" required>
        <el-upload
          :show-file-list="false"
          accept="image/*"
          :http-request="upload"
          multiple
        >
          <el-button :loading="uploading">上传照片</el-button>
        </el-upload>
        <div class="photos">
          <el-tag
            v-for="p in photos"
            :key="p.key"
            closable
            @close="photos = photos.filter(x => x.key !== p.key)"
            >{{ p.name }}</el-tag
          >
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="danger"
        :loading="busy"
        :disabled="!reason.trim() || photos.length === 0"
        @click="submit"
        >确认报废</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.photos {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
</style>
