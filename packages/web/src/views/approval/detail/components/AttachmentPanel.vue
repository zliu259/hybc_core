<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { formatFileSize } from "../formatters";
import type { AttachmentItem } from "../types";
import ApprovalPanel from "./ApprovalPanel.vue";

defineOptions({ name: "AttachmentPanel" });

defineProps<{
  items: AttachmentItem[];
  canUpload: boolean;
  uploading: boolean;
  upload: (options: UploadRequestOptions) => Promise<void>;
  emptyText: string;
}>();

const emit = defineEmits<{
  preview: [item: AttachmentItem];
  download: [item: AttachmentItem];
}>();

/** 文件类型直接写成文字：比图标更好认，也不用再加载图标资源。 */
const fileBadge = (fileName: string): string => {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return "图片";
  return extension && extension.length <= 4 ? extension.toUpperCase() : "文件";
};
</script>

<template>
  <ApprovalPanel :title="`附件（${items.length}）`">
    <template #extra>
      <el-upload
        v-if="canUpload"
        :show-file-list="false"
        :http-request="upload"
        :disabled="uploading"
      >
        <el-button size="small" :loading="uploading">上传附件</el-button>
      </el-upload>
    </template>

    <p v-if="items.length === 0" class="attachment-panel__empty">
      {{ emptyText }}
    </p>
    <ul v-else class="attachment-panel__list">
      <li v-for="item in items" :key="item.file_key">
        <button
          type="button"
          class="attachment-panel__open"
          :title="`预览 ${item.file_name}`"
          @click="emit('preview', item)"
        >
          <span class="attachment-panel__badge">
            {{ fileBadge(item.file_name) }}
          </span>
          <span class="attachment-panel__name">{{ item.file_name }}</span>
          <span class="attachment-panel__size">
            {{ formatFileSize(item.file_size) }}
          </span>
        </button>
        <el-button link size="small" @click="emit('download', item)">
          下载
        </el-button>
      </li>
    </ul>
  </ApprovalPanel>
</template>

<style scoped>
.attachment-panel__empty {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.attachment-panel__list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.attachment-panel__list li {
  display: flex;
  gap: 8px;
  align-items: center;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.attachment-panel__list li:first-child {
  border-top: none;
}

.attachment-panel__open {
  display: flex;
  flex: 1;
  gap: 10px;
  align-items: center;
  min-width: 0;
  padding: 8px 6px;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 4px;
}

.attachment-panel__open:hover {
  background: var(--el-fill-color-light);
}

.attachment-panel__open:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}

.attachment-panel__badge {
  flex: none;
  min-width: 36px;
  padding: 1px 4px;
  font-size: 11px;
  line-height: 18px;
  color: var(--el-text-color-regular);
  text-align: center;
  background: var(--el-fill-color);
  border-radius: 3px;
}

.attachment-panel__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
  color: var(--el-color-primary);
  white-space: nowrap;
}

.attachment-panel__size {
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
