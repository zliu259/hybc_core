<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";

import { getDocFileUrl } from "@/api/wh/doc-library";
import type { DocFileRow } from "@/api/wh/doc-library-types";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { normalizeApiUrl } from "@/utils/api-url";
import { message } from "@/utils/message";
import { formatFileSize, previewKind } from "../doc-view";

// pdf.js 很大，只在真的打开 PDF 时才加载
const PdfPreview = defineAsyncComponent(() => import("./PdfPreview.vue"));

const props = defineProps<{ doc: DocFileRow | null }>();
const visible = defineModel<boolean>({ required: true });

interface ViewUrl {
  url: string;
  expiresAt: number;
}

const view = ref<ViewUrl | null>(null);
const loading = ref(false);
const error = ref("");
const downloading = ref(false);
const video = ref<HTMLVideoElement | null>(null);
/** 视频地址过期后重新取地址，回到原来的进度 */
let resumeAt = 0;
let seq = 0;

const kind = computed(() =>
  props.doc ? previewKind(props.doc.content_type) : "download"
);

/** 签名地址 15 分钟有效：打开对话框时才取。 */
const loadUrl = async (): Promise<void> => {
  const doc = props.doc;
  if (!doc) return;
  seq += 1;
  const mine = seq;
  loading.value = true;
  error.value = "";
  try {
    const result = await getDocFileUrl(doc.id);
    if (mine !== seq) return;
    view.value = {
      url: normalizeApiUrl(result.data.url),
      expiresAt: Date.parse(result.data.expires_at)
    };
  } catch (cause) {
    if (mine !== seq) return;
    view.value = null;
    error.value = resolveApiErrorMessage(cause, "取不到文件，请稍后重试");
  } finally {
    if (mine === seq) loading.value = false;
  }
};

watch(
  () => [visible.value, props.doc?.id] as const,
  ([open]) => {
    seq += 1;
    view.value = null;
    error.value = "";
    resumeAt = 0;
    if (open) void loadUrl();
  }
);

const onPdfFailed = () => {
  const expired = view.value !== null && Date.now() >= view.value.expiresAt;
  view.value = null;
  error.value = expired
    ? "打开太久，文件地址过期了，点「重新打开」。"
    : "这个 PDF 在页面里打不开，可以下载后查看。";
};

const onVideoError = () => {
  const current = view.value;
  // 只在地址确实过期时重取，别的错误（格式放不了）不反复试
  if (!current || Date.now() < current.expiresAt) {
    error.value = "这个视频在页面里放不了，可以下载后查看。";
    view.value = null;
    return;
  }
  resumeAt = video.value?.currentTime ?? 0;
  void loadUrl();
};

const onVideoReady = () => {
  if (resumeAt > 0 && video.value) video.value.currentTime = resumeAt;
  resumeAt = 0;
};

/** 每次下载都取一个新地址，藏在看不见的 iframe 里下：不会被拦弹窗，也不会把当前页面带走。 */
const download = async () => {
  const doc = props.doc;
  if (!doc) return;
  downloading.value = true;
  try {
    const result = await getDocFileUrl(doc.id);
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = `${normalizeApiUrl(result.data.url)}&download=1`;
    document.body.appendChild(frame);
    window.setTimeout(() => frame.remove(), 60_000);
    message("已开始下载", { type: "success" });
  } catch (cause) {
    message(resolveApiErrorMessage(cause, "下载失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    downloading.value = false;
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="props.doc?.title ?? '查看资料'"
    width="min(1100px, 94vw)"
    top="4vh"
    destroy-on-close
    class="doc-preview"
  >
    <div v-if="props.doc" class="meta">
      <span class="name">{{ props.doc.file_name }}</span>
      <span>{{ formatFileSize(props.doc.file_size) }}</span>
      <el-tag v-if="!props.doc.is_latest" type="info" size="small"
        >旧版本</el-tag
      >
      <div class="spacer" />
      <a
        v-if="kind === 'pdf' && view"
        :href="view.url"
        target="_blank"
        rel="noopener"
        class="link"
        >在新窗口打开</a
      >
      <el-button
        v-if="kind !== 'download'"
        type="primary"
        :loading="downloading"
        @click="download"
        >下载</el-button
      >
    </div>
    <div
      v-loading="loading"
      class="stage"
      :class="{ compact: kind === 'download' || Boolean(error) }"
    >
      <div v-if="error" class="notice">
        <p>{{ error }}</p>
        <el-button @click="loadUrl">重新打开</el-button>
      </div>
      <template v-else-if="view">
        <PdfPreview
          v-if="kind === 'pdf'"
          :url="view.url"
          @failed="onPdfFailed"
        />
        <div v-else-if="kind === 'image'" class="media">
          <img :src="view.url" :alt="props.doc?.title" />
        </div>
        <div v-else-if="kind === 'video'" class="media">
          <video
            ref="video"
            :src="view.url"
            controls
            preload="metadata"
            @error="onVideoError"
            @loadedmetadata="onVideoReady"
          />
        </div>
        <div v-else class="notice">
          <p>这种文件不能在页面里看，请下载后打开。</p>
          <el-button type="primary" :loading="downloading" @click="download"
            >下载</el-button
          >
        </div>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.name {
  color: var(--el-text-color-regular);
  word-break: break-all;
}

.spacer {
  flex: 1;
}

.link {
  color: var(--el-color-primary);
}

.stage {
  height: calc(100vh - 4vh - 230px);
  min-height: 320px;
}

.stage.compact {
  height: 220px;
  min-height: 0;
}

.media {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--el-fill-color-light);
}

.media img,
.media video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.notice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--el-text-color-secondary);
}
</style>
