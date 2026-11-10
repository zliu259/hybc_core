<script setup lang="ts">
import { Tickets } from "@element-plus/icons-vue";
import { computed, ref } from "vue";

import type { AttachmentReviewView } from "@/api/reimbursement";
import type { UploadItem } from "./useEnvelopeUploads";
import {
  attachmentStatusText,
  hasBlockingDuplicate,
  isProblemView,
  pickerGroupTitle,
  sortAttachmentViews,
  type InfoSummary,
  type PickerSelection
} from "./view-model";

const props = defineProps<{
  views: AttachmentReviewView[];
  uploads: UploadItem[];
  selection: PickerSelection;
  infoSummary: InfoSummary;
  infoEditable: boolean;
  canUpload: boolean;
  canDelete: boolean;
}>();

const emit = defineEmits<{
  (event: "select", selection: PickerSelection): void;
  (event: "files", files: File[]): void;
  (event: "retry", localId: string): void;
  (event: "dismiss", localId: string): void;
  (event: "remove", view: AttachmentReviewView): void;
}>();

const sortedViews = computed(() => sortAttachmentViews(props.views));
const groupTitle = computed(() => pickerGroupTitle(props.views));
const infoSelected = computed(() => props.selection.kind === "info");
const infoAction = computed(() => {
  if (infoSelected.value) return "正在查看";
  return props.infoEditable ? "查看 / 修改 ›" : "查看 ›";
});
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const onPick = (event: Event) => {
  const input = event.target as HTMLInputElement;
  emit("files", Array.from(input.files ?? []));
  input.value = "";
};

const onDrop = (event: DragEvent) => {
  dragging.value = false;
  if (!props.canUpload) return;
  emit("files", Array.from(event.dataTransfer?.files ?? []));
};

const isSelected = (attachmentId: number) =>
  props.selection.kind === "attachment" &&
  props.selection.attachmentId === attachmentId;
</script>

<template>
  <nav class="rb-picker">
    <div class="rb-info-wrap">
      <button
        type="button"
        class="rb-info-card"
        :class="{ 'rb-info-card--on': infoSelected }"
        :aria-pressed="infoSelected"
        @click="emit('select', { kind: 'info' })"
      >
        <span class="rb-info-card__icon" aria-hidden="true">
          <el-icon :size="18"><Tickets /></el-icon>
        </span>
        <span class="rb-info-card__body">
          <span class="rb-info-card__head">
            <span class="rb-info-card__title">报销信息</span>
            <span class="rb-info-card__action">{{ infoAction }}</span>
          </span>
          <span class="rb-info-card__amount">{{ infoSummary.amount }}</span>
          <span class="rb-info-card__meta">{{ infoSummary.meta }}</span>
        </span>
      </button>
    </div>

    <div class="rb-group">{{ groupTitle }}</div>

    <div v-if="canUpload" class="rb-drop-wrap">
      <div
        class="rb-drop"
        :class="{ 'rb-drop--over': dragging }"
        role="button"
        tabindex="0"
        @click="fileInput?.click()"
        @keydown.enter="fileInput?.click()"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        把发票拖到这里，或<em>点击选择</em>，可以一次选多个
        <small>PDF、JPG、PNG，单个不超过 20MB</small>
      </div>
      <input
        ref="fileInput"
        class="rb-file-input"
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png"
        @change="onPick"
      />
    </div>

    <div class="rb-list">
      <div
        v-for="item in uploads"
        :key="item.localId"
        class="rb-pick rb-pick--upload"
      >
        <div class="rb-pick__line">
          <span class="rb-pick__name">{{ item.name }}</span>
          <span
            v-if="item.status === 'failed'"
            class="rb-pick__state rb-pick__state--bad"
            >上传失败</span
          >
          <span v-else-if="item.status === 'waiting'" class="rb-pick__state"
            >等待上传</span
          >
          <span v-else class="rb-pick__state">{{ item.progress }}%</span>
        </div>
        <span v-if="item.status === 'uploading'" class="rb-bar">
          <i :style="{ width: `${item.progress}%` }" />
        </span>
        <div v-if="item.status === 'failed'" class="rb-pick__tools">
          <span class="rb-pick__error">{{ item.error }}</span>
          <el-button
            link
            type="primary"
            size="small"
            @click="emit('retry', item.localId)"
            >重试</el-button
          >
          <el-button link size="small" @click="emit('dismiss', item.localId)"
            >移除</el-button
          >
        </div>
      </div>

      <div
        v-for="view in sortedViews"
        :key="view.attachment_id"
        class="rb-pick"
        :class="{ 'rb-pick--on': isSelected(view.attachment_id) }"
        role="button"
        tabindex="0"
        @click="
          emit('select', {
            kind: 'attachment',
            attachmentId: view.attachment_id
          })
        "
        @keydown.enter="
          emit('select', {
            kind: 'attachment',
            attachmentId: view.attachment_id
          })
        "
      >
        <div class="rb-pick__line">
          <span class="rb-pick__name">{{ view.display_name }}</span>
          <span
            class="rb-pick__state"
            :class="{
              'rb-pick__state--bad':
                isProblemView(view) && view.state !== 'recognized',
              'rb-pick__state--amount': view.state === 'recognized'
            }"
          >
            {{ attachmentStatusText(view) }}
          </span>
          <el-button
            v-if="canDelete"
            link
            size="small"
            class="rb-pick__delete"
            :aria-label="`删除 ${view.display_name}`"
            @click.stop="emit('remove', view)"
          >
            删除
          </el-button>
        </div>
        <div
          v-if="
            hasBlockingDuplicate(view) || view.merged_label || view.attention
          "
          class="rb-pick__badges"
        >
          <span v-if="hasBlockingDuplicate(view)" class="rb-badge rb-badge--bad"
            >疑似重复</span
          >
          <span v-if="view.merged_label" class="rb-badge rb-badge--bad">{{
            view.merged_label
          }}</span>
          <span v-if="view.attention" class="rb-badge">留意</span>
        </div>
      </div>
    </div>
  </nav>
</template>

<style scoped>
.rb-picker {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  border-right: 1px solid #e7ebf0;
}

.rb-group {
  padding: 12px 16px 6px 24px;
  font-weight: 600;
  color: #1f2329;
  border-top: 1px solid #e7ebf0;
}

.rb-list {
  max-height: 560px;
  overflow-y: auto;
}

.rb-pick {
  display: block;
  width: 100%;
  padding: 8px 16px 8px 24px;
  color: #1f2329;
  text-align: left;
  cursor: pointer;
  background: none;
  border: 0;
  border-top: 1px solid #e7ebf0;
}

.rb-info-wrap {
  padding: 12px 16px 12px 24px;
}

.rb-info-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
  padding: 12px 14px;
  color: #1f2329;
  text-align: left;
  cursor: pointer;
  background: #f3f7ff;
  border: 1px solid #c9dafc;
  border-radius: 10px;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    box-shadow 0.15s;
}

.rb-info-card:hover {
  background: #eaf2ff;
  border-color: #1361d8;
}

.rb-info-card:focus-visible {
  outline: 2px solid #1361d8;
  outline-offset: 2px;
}

.rb-info-card--on {
  background: #e6f0ff;
  border-color: #1361d8;
  box-shadow: inset 0 0 0 1px #1361d8;
}

.rb-info-card__icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: #fff;
  background: #1361d8;
  border-radius: 8px;
}

.rb-info-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rb-info-card__head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.rb-info-card__title {
  font-size: 14px;
  font-weight: 600;
}

.rb-info-card__action {
  flex: none;
  font-size: 12px;
  color: #1361d8;
}

.rb-info-card__amount {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rb-info-card__meta {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  color: #5c667a;
  -webkit-box-orient: vertical;
}

.rb-pick--upload {
  cursor: default;
}

.rb-pick--on {
  background: #e6f0ff;
  box-shadow: inset 3px 0 0 #1361d8;
}

.rb-pick:focus-visible {
  outline: 2px solid #1361d8;
  outline-offset: -2px;
}

.rb-pick__line {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.rb-pick__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rb-pick__state {
  flex: none;
  color: #5c667a;
}

.rb-pick__state--amount {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #1f2329;
}

.rb-pick__state--bad {
  color: #b4470c;
}

.rb-pick__delete {
  flex: none;
  color: #5c667a;
}

.rb-pick__tools {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 2px;
}

.rb-pick__error {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #b4470c;
  white-space: nowrap;
}

.rb-pick__badges {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.rb-badge {
  padding: 0 6px;
  font-size: 12px;
  line-height: 18px;
  color: #5c667a;
  background: #f1f3f7;
  border-radius: 4px;
}

.rb-badge--bad {
  color: #b4470c;
  background: #fdf0e8;
}

.rb-bar {
  display: block;
  height: 3px;
  margin-top: 4px;
  overflow: hidden;
  background: #edf0f4;
  border-radius: 2px;
}

.rb-bar i {
  display: block;
  height: 100%;
  background: #1361d8;
}

.rb-drop-wrap {
  padding: 0 16px 12px 24px;
}

.rb-drop {
  padding: 12px;
  color: #5c667a;
  text-align: center;
  cursor: pointer;
  background: #f6f8fb;
  border: 1px dashed #c5cede;
  border-radius: 10px;
}

.rb-drop em {
  font-style: normal;
  color: #1361d8;
}

.rb-drop small {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #8a94a6;
}

.rb-drop--over {
  background: #e6f0ff;
  border-color: #1361d8;
}

.rb-file-input {
  display: none;
}

@container (max-width: 860px) {
  .rb-picker {
    border-right: 0;
    border-bottom: 1px solid #e7ebf0;
  }

  .rb-group,
  .rb-pick,
  .rb-info-wrap {
    padding-left: 16px;
  }

  .rb-drop-wrap {
    padding-left: 16px;
  }

  .rb-list {
    max-height: 280px;
  }
}
</style>
