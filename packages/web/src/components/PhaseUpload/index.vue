<script setup lang="ts">
import { ref } from "vue";
import { message } from "@/utils/message";
import { createUploadSignature } from "@/api/upload";

type UploadedItem = {
  name: string;
  key: string;
  url: string;
};

const props = withDefaults(
  defineProps<{
    category?: string;
    modelValue?: UploadedItem[];
  }>(),
  {
    category: "common",
    modelValue: () => []
  }
);

const emit = defineEmits<{
  "update:modelValue": [UploadedItem[]];
}>();

const uploading = ref(false);

const beforeUpload = async (file: File) => {
  uploading.value = true;
  try {
    const signResult = await createUploadSignature({
      fileName: file.name,
      contentType: file.type,
      category: props.category
    });

    const signed = signResult.data;
    await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": file.type || "application/octet-stream"
      },
      body: file
    });

    emit("update:modelValue", [
      ...props.modelValue,
      {
        name: file.name,
        key: signed.key,
        url: signed.fileUrl
      }
    ]);
    message("上传成功", { type: "success" });
  } catch {
    message("上传失败", { type: "error" });
  } finally {
    uploading.value = false;
  }

  return false;
};

const removeFile = (key: string) => {
  emit(
    "update:modelValue",
    props.modelValue.filter(item => item.key !== key)
  );
};
</script>

<template>
  <div class="phase-upload">
    <el-upload
      action="#"
      :show-file-list="false"
      :before-upload="beforeUpload"
      :disabled="uploading"
    >
      <el-button type="primary" :loading="uploading">上传文件</el-button>
    </el-upload>

    <el-empty v-if="modelValue.length === 0" description="暂无文件" />
    <el-table v-else :data="modelValue" size="small" style="margin-top: 12px">
      <el-table-column prop="name" label="文件名" />
      <el-table-column label="访问" width="120">
        <template #default="scope">
          <el-link :href="scope.row.url" target="_blank" type="primary"
            >查看</el-link
          >
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="scope">
          <el-button link type="danger" @click="removeFile(scope.row.key)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
