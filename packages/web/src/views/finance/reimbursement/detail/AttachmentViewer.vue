<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { AttachmentReviewView } from "@/api/reimbursement";
import { resolveViewableFileUrl } from "@/api/upload";
import {
  attachmentStatusText,
  formatYuan,
  hasBlockingDuplicate
} from "./view-model";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

const props = defineProps<{
  view: AttachmentReviewView;
  canRerecognize: boolean;
  rerecognizing: boolean;
}>();

const emit = defineEmits<{
  (event: "rerecognize", attachmentId: number): void;
  (event: "open-envelope", envelopeId: number): void;
}>();

const fileUrl = ref("");
const loadingUrl = ref(false);
let requestSequence = 0;

const fileName = computed(() => props.view.file_name || props.view.file_key);
const isImage = computed(() => {
  const lower = fileName.value.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
});
const isPdf = computed(() => fileName.value.toLowerCase().endsWith(".pdf"));

// 签名地址有时效，每次切换重新取
watch(
  () => props.view.file_key,
  async key => {
    requestSequence += 1;
    const sequence = requestSequence;
    fileUrl.value = "";
    loadingUrl.value = true;
    const url = await resolveViewableFileUrl(key);
    if (sequence !== requestSequence) return;
    fileUrl.value = url;
    loadingUrl.value = false;
  },
  { immediate: true }
);

const fields = computed(() => [
  { label: "销售方", value: props.view.seller_name || "-" },
  { label: "发票号", value: props.view.invoice_no || "-" },
  { label: "开票日期", value: props.view.invoice_date || "-" },
  {
    label: "金额",
    value:
      props.view.amount !== null
        ? formatYuan(props.view.amount)
        : attachmentStatusText(props.view)
  }
]);

const duplicateRows = computed(() =>
  hasBlockingDuplicate(props.view)
    ? props.view.duplicates.filter(item =>
        ["high", "medium"].includes(item.risk_level)
      )
    : []
);
</script>

<template>
  <section class="rb-viewer">
    <div class="rb-sheet">
      <span v-if="loadingUrl" class="rb-sheet__hint">正在打开原件…</span>
      <img
        v-else-if="fileUrl && isImage"
        :src="fileUrl"
        :alt="fileName"
        class="rb-sheet__image"
      />
      <iframe
        v-else-if="fileUrl && isPdf"
        :src="fileUrl"
        :title="fileName"
        class="rb-sheet__frame"
      />
      <span v-else class="rb-sheet__hint"
        >这个格式不能直接预览，请下载查看</span
      >
    </div>

    <div class="rb-file-bar">
      <span class="rb-file-bar__name">{{ fileName }}</span>
      <a
        v-if="fileUrl"
        :href="fileUrl"
        target="_blank"
        rel="noopener noreferrer"
        :download="fileName"
        >下载</a
      >
    </div>

    <dl class="rb-kv4">
      <div v-for="field in fields" :key="field.label">
        <dt>{{ field.label }}</dt>
        <dd>{{ field.value }}</dd>
      </div>
    </dl>

    <p v-if="view.merged_label" class="rb-line rb-line--bad">
      这个文件{{ view.merged_label }}，系统没法逐张查重。
    </p>

    <dl
      v-if="
        (view.amount === null || view.merged_label) && view.raw_text_summary
      "
      class="rb-read"
    >
      <dt>系统读到的内容</dt>
      <dd>{{ view.raw_text_summary }}</dd>
    </dl>

    <p v-if="view.state === 'failed'" class="rb-line">
      这张没读出来，可以看原件。
      <el-button
        v-if="canRerecognize"
        link
        type="primary"
        :loading="rerecognizing"
        @click="emit('rerecognize', view.attachment_id)"
      >
        重新识别
      </el-button>
    </p>

    <p
      v-for="(item, index) in duplicateRows"
      :key="index"
      class="rb-line rb-line--bad"
    >
      {{ item.summary || "疑似重复" }}
      <el-button
        v-if="item.matched_envelope_id"
        link
        type="primary"
        @click="emit('open-envelope', item.matched_envelope_id as number)"
      >
        查看那张报销
      </el-button>
    </p>

    <p v-if="view.attention" class="rb-line rb-line--bad">
      需要留意：{{ view.attention }}
    </p>
  </section>
</template>

<style scoped>
.rb-viewer {
  min-width: 0;
  padding: 16px 24px 20px;
  font-size: 13px;
  line-height: 20px;
}

.rb-sheet {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 520px;
  overflow: auto;
  background: #f6f8fb;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
}

.rb-sheet__hint {
  color: #8a94a6;
}

.rb-sheet__image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.rb-sheet__frame {
  width: 100%;
  height: 100%;
  border: 0;
}

.rb-file-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  color: #5c667a;
}

.rb-file-bar__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rb-file-bar a {
  flex: none;
  color: #1361d8;
}

.rb-kv4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 12px 0 0;
}

.rb-kv4 dt,
.rb-read dt {
  color: #8a94a6;
}

.rb-kv4 dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.rb-read {
  margin: 12px 0 0;
}

.rb-read dd {
  margin: 2px 0 0;
  line-height: 22px;
}

.rb-line {
  margin: 10px 0 0;
  color: #1f2329;
}

.rb-line--bad {
  color: #b4470c;
}

@container (max-width: 860px) {
  .rb-viewer {
    padding: 14px 16px 16px;
  }

  .rb-sheet {
    height: 360px;
  }

  .rb-kv4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
