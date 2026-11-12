<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { getDocConfig, listDocsForDevice } from "@/api/wh/doc-library";
import type { DocFileRow, DocLibraryConfig } from "@/api/wh/doc-library-types";
import { listDeviceCategories } from "@/api/wh/settings";
import type { DeviceCategory } from "@/api/wh/types";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import {
  docCategoryLabel,
  formatFileSize,
  groupDocsByScope,
  validityTag,
  type DocOwner
} from "../doc-view";
import DocPreviewDialog from "./DocPreviewDialog.vue";
import DocUploadDialog from "./DocUploadDialog.vue";

/**
 * 一台设备适用的资料：它自己的、它这类设备的、通用的，分三段。
 * 设备详情用完整版；任务抽屉用 compact（只列标题和类别）。taskKind 让接口把干这个活要看的排前面。
 */
const props = defineProps<{
  deviceId: number;
  /** 设备叫什么（上传时显示在归属里） */
  deviceLabel?: string | null;
  taskKind?: string;
  compact?: boolean;
  /** 能不能在这里直接上传（资料管理员，完整版才有） */
  canUpload?: boolean;
}>();

const router = useRouter();
const rows = ref<DocFileRow[]>([]);
const loading = ref(false);
const failed = ref("");
const active = ref<DocFileRow | null>(null);
const previewVisible = ref(false);
const uploadVisible = ref(false);
const config = ref<DocLibraryConfig | null>(null);
const categories = ref<DeviceCategory[]>([]);
let seq = 0;

const groups = computed(() => groupDocsByScope(rows.value));
const owner = computed<DocOwner>(() => ({
  kind: "device",
  deviceId: props.deviceId,
  categoryId: null
}));

const load = async () => {
  seq += 1;
  const mine = seq;
  loading.value = true;
  failed.value = "";
  try {
    const result = await listDocsForDevice(props.deviceId, props.taskKind);
    if (mine === seq) rows.value = result.data;
  } catch (error) {
    if (mine !== seq) return;
    rows.value = [];
    failed.value = resolveApiErrorMessage(error, "资料取不到，请稍后重试");
  } finally {
    if (mine === seq) loading.value = false;
  }
};

watch(
  () => [props.deviceId, props.taskKind] as const,
  () => void load(),
  { immediate: true }
);

const view = (row: DocFileRow) => {
  active.value = row;
  previewVisible.value = true;
};

/** 上传要用的设置和设备类别，点「上传」时才取。 */
const openUpload = async () => {
  if (!config.value) {
    try {
      const [configResult, categoryResult] = await Promise.all([
        getDocConfig(),
        listDeviceCategories()
      ]);
      config.value = configResult.data;
      categories.value = categoryResult.data;
    } catch (error) {
      message(resolveApiErrorMessage(error, "上传设置取不到，请稍后重试"), {
        type: "error"
      });
      return;
    }
  }
  uploadVisible.value = true;
};
</script>

<template>
  <div
    v-loading="loading"
    class="device-docs"
    :class="{ compact: props.compact }"
  >
    <div v-if="!props.compact" class="actions">
      <el-button
        link
        type="primary"
        @click="router.push(`/wh/doc-library?device_id=${props.deviceId}`)"
        >在资料库里看</el-button
      >
      <el-button
        v-if="props.canUpload"
        type="primary"
        size="small"
        @click="openUpload"
        >上传到这台设备</el-button
      >
    </div>
    <div v-if="failed" class="empty">
      {{ failed }}
      <el-button link type="primary" @click="load">重试</el-button>
    </div>
    <div v-else-if="groups.length === 0 && !loading" class="empty">
      还没有资料
    </div>
    <div v-for="group in groups" :key="group.scope" class="group">
      <div class="group-title">{{ group.label }}</div>
      <div v-for="row in group.rows" :key="row.id" class="row">
        <el-link type="primary" class="title" @click="view(row)">{{
          row.title
        }}</el-link>
        <span class="meta">{{ docCategoryLabel(row.doc_category) }}</span>
        <el-tag
          v-if="validityTag(row.validity)"
          :type="validityTag(row.validity)!.type"
          size="small"
          >{{ validityTag(row.validity)!.text }}</el-tag
        >
        <template v-if="!props.compact">
          <span class="meta">{{ formatFileSize(row.file_size) }}</span>
          <span v-if="row.valid_until" class="meta"
            >有效期至 {{ row.valid_until }}</span
          >
        </template>
      </div>
    </div>
    <DocPreviewDialog v-model="previewVisible" :doc="active" />
    <DocUploadDialog
      v-if="props.canUpload && !props.compact"
      v-model="uploadVisible"
      :config="config"
      :categories="categories"
      :replace-target="null"
      :default-owner="owner"
      :default-device-label="props.deviceLabel ?? null"
      @uploaded="load"
    />
  </div>
</template>

<style scoped>
.device-docs {
  min-height: 40px;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 4px;
}

.group + .group {
  margin-top: 12px;
}

.group-title {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.compact .row {
  padding: 3px 0;
  border-bottom: none;
}

.title {
  word-break: break-all;
}

.meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty {
  padding: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
