<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import type { ContractDraftSection } from "@/api/contract-draft";
import { fillPlaceholders } from "../lib/segments";

const props = defineProps<{
  visible: boolean;
  title: string;
  sections: ContractDraftSection[];
  keywordValues: Record<string, string>;
  /** 正文中未出现的关键字标签（用户没有点选入口），仅提示不阻塞 */
  absentKeywordLabels?: string[];
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

const plainText = computed(() => {
  const parts = props.sections.map(
    (s, idx) =>
      `第${idx + 1}节 ${s.title}\n${fillPlaceholders(s.content, props.keywordValues)}`
  );
  return [props.title, ...parts].join("\n\n");
});

const copyAll = async () => {
  try {
    await navigator.clipboard.writeText(plainText.value);
    ElMessage.success("已复制全文");
  } catch {
    ElMessage.error("复制失败，请手动选中复制");
  }
};
</script>

<template>
  <el-drawer
    :model-value="visible"
    title="纯文本预览"
    size="60%"
    direction="rtl"
    @update:model-value="(v: boolean) => emit('update:visible', v)"
  >
    <div class="preview-toolbar">
      <el-button size="small" type="primary" @click="copyAll"
        >复制全文</el-button
      >
    </div>
    <pre class="plain-preview">{{ plainText }}</pre>
    <el-text
      v-if="props.absentKeywordLabels?.length"
      class="absent-hint"
      size="small"
      type="info"
    >
      以下关键字未出现在当前正文中（无点选入口，不影响导出）：{{
        props.absentKeywordLabels.join("、")
      }}
    </el-text>
  </el-drawer>
</template>

<style scoped>
.preview-toolbar {
  margin-bottom: 8px;
  text-align: right;
}

.plain-preview {
  margin: 0;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.9;
  word-break: break-all;
  white-space: pre-wrap;
}

.absent-hint {
  display: block;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px dashed var(--el-border-color);
}
</style>
