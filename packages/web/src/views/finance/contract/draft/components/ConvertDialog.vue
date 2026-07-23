<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import type {
  ContractDraft,
  ContractDraftSection,
  FixedSection
} from "@/api/contract-draft";
import { buildDocxBlobFromBlocks } from "@/views/bidding/dedup/lib/docx-export";
import { buildContractDocxBlocks } from "../lib/contract-docx-blocks";
import { collectUnfilledKeys, fillPlaceholdersForDoc } from "../lib/segments";

const props = defineProps<{
  visible: boolean;
  draft: ContractDraft;
  sections: ContractDraftSection[];
  keywordValues: Record<string, string>;
}>();
const emit = defineEmits<{ (e: "update:visible", v: boolean): void }>();

const generating = ref(false);
const downloadUrl = ref<string | null>(null);
const downloadName = ref("");
const dlAnchor = ref<HTMLAnchorElement | null>(null);

// 已填占位符换真实值、未填换下划线空白（保留 {{__table__}} 哨兵），组装为 docx 块。
const fixedSections = computed<FixedSection[]>(() =>
  props.sections.map(s => ({
    id: s.id,
    section_key: s.section_key,
    title: s.title,
    content: fillPlaceholdersForDoc(s.content, props.keywordValues),
    table_json: s.table_json
  }))
);
const docxBlocks = computed(() =>
  buildContractDocxBlocks(props.draft.title, fixedSections.value)
);
const unfilledKeys = computed(() =>
  collectUnfilledKeys(
    props.sections.map(s => s.content),
    props.keywordValues
  )
);

const revokeUrl = () => {
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value);
    downloadUrl.value = null;
  }
};

async function runDownload(): Promise<void> {
  generating.value = true;
  try {
    const blob = await buildDocxBlobFromBlocks(docxBlocks.value);
    revokeUrl();
    downloadUrl.value = URL.createObjectURL(blob);
    downloadName.value = `${props.draft.title || "合同"}.docx`;
    await nextTick();
    dlAnchor.value?.click(); // 弹出下载链接后自动开始下载
    ElMessage.success("已生成并开始下载");
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : "生成失败，请重试");
  } finally {
    generating.value = false;
  }
}

// 关闭时释放对象 URL，避免内存泄漏
watch(
  () => props.visible,
  v => {
    if (!v) revokeUrl();
  }
);
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="生成合同 Word 文档"
    width="520px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-alert
      type="info"
      :closable="false"
      title="按当前草稿内容生成 Word 文档（.docx）并下载。生成不会锁定草稿、不发起审批；如需正式归档请在合同管理中另行提交。"
    />
    <el-alert
      v-if="unfilledKeys.length"
      class="unfilled"
      type="warning"
      :closable="false"
      :title="`有 ${unfilledKeys.length} 个字段未填写，文档中将以下划线空白留位，可下载后手工补填。`"
    />
    <div v-if="downloadUrl" class="dl-line">
      <span class="dl-label">📄 已生成：</span>
      <a
        ref="dlAnchor"
        :href="downloadUrl"
        :download="downloadName"
        class="dl-link"
      >
        {{ downloadName }}
      </a>
      <span class="dl-hint">（未自动下载？点击文件名下载）</span>
    </div>
    <template #footer>
      <el-button :disabled="generating" @click="emit('update:visible', false)"
        >关闭</el-button
      >
      <el-button type="primary" :loading="generating" @click="runDownload">
        {{ downloadUrl ? "重新生成并下载" : "生成并下载" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.unfilled {
  margin-top: 10px;
}

.dl-line {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 14px;
  font-size: 14px;
}

.dl-link {
  color: var(--el-color-primary);
  text-decoration: underline;
}

.dl-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
