<script setup lang="ts">
import { formatFileSize } from "../doc-view";
import type { UploadItemState } from "../upload-queue";

/** 上传队列里每个文件的进度；失败的显示原因和「重试」。 */
const props = defineProps<{ items: UploadItemState[] }>();
const emit = defineEmits<{ retry: [key: string]; cancel: [key: string] }>();

const percent = (item: UploadItemState): number =>
  item.status === "done"
    ? 100
    : item.size > 0
      ? Math.min(99, Math.floor((item.sentBytes / item.size) * 100))
      : 0;

const statusText = (item: UploadItemState): string => {
  if (item.status === "done") return "已上传";
  if (item.status === "failed") return "失败";
  if (item.status === "uploading") return `上传中 ${percent(item)}%`;
  return "排队中";
};
</script>

<template>
  <div class="queue">
    <div v-for="item in props.items" :key="item.key" class="row">
      <div class="head">
        <span class="name" :title="item.name">{{ item.name }}</span>
        <span class="size">{{ formatFileSize(item.size) }}</span>
        <span class="status" :class="item.status">{{ statusText(item) }}</span>
        <el-button
          v-if="item.status === 'failed'"
          link
          type="primary"
          @click="emit('retry', item.key)"
          >重试</el-button
        >
        <el-button
          v-if="item.status !== 'done'"
          link
          @click="emit('cancel', item.key)"
          >{{ item.status === "failed" ? "不传了" : "取消" }}</el-button
        >
      </div>
      <el-progress
        v-if="item.status === 'uploading'"
        :percentage="percent(item)"
        :show-text="false"
        :stroke-width="4"
      />
      <div v-if="item.error" class="error">{{ item.error }}</div>
    </div>
    <div v-if="props.items.length === 0" class="empty">没有要传的文件</div>
  </div>
</template>

<style scoped>
.queue {
  max-height: 360px;
  overflow: auto;
}

.row {
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.head {
  display: flex;
  gap: 12px;
  align-items: center;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.size,
.status {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.status.done {
  color: var(--el-color-success);
}

.status.failed,
.error {
  color: var(--el-color-danger);
}

.error {
  margin-top: 4px;
  font-size: 12px;
}

.empty {
  padding: 24px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
