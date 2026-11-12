<script lang="ts">
import type { DocCategory } from "@/api/wh/doc-library-types";

export interface UploadDraft {
  key: string;
  file: File;
  title: string;
  category: DocCategory;
  validUntil: string | null;
}

/** 只有合格证和检测报告有有效期 */
export const hasValidity = (category: DocCategory): boolean =>
  category === "cert" || category === "report";
</script>

<script setup lang="ts">
import type { DocLibraryConfig } from "@/api/wh/doc-library-types";
import { formatFileSize } from "../doc-view";

/** 选好还没传的文件：逐个改标题、资料类别、有效期，或者移除。 */
const props = defineProps<{
  drafts: UploadDraft[];
  docCategories: DocLibraryConfig["categories"];
  /** 表头给不给「全部设为某类」 */
  batch: boolean;
}>();
const emit = defineEmits<{ change: [drafts: UploadDraft[]] }>();

const updateDraft = (key: string, change: Partial<UploadDraft>) =>
  emit(
    "change",
    props.drafts.map(draft =>
      draft.key === key ? { ...draft, ...change } : draft
    )
  );
const removeDraft = (key: string) =>
  emit(
    "change",
    props.drafts.filter(draft => draft.key !== key)
  );
const setAllCategories = (category: DocCategory | undefined) => {
  if (!category) return;
  emit(
    "change",
    props.drafts.map(draft => ({ ...draft, category }))
  );
};
</script>

<template>
  <el-table :data="props.drafts" row-key="key" max-height="320">
    <el-table-column label="文件" min-width="170">
      <template #default="{ row }">
        <div class="file">{{ row.file.name }}</div>
        <div class="sub">{{ formatFileSize(row.file.size) }}</div>
      </template>
    </el-table-column>
    <el-table-column label="标题" min-width="190">
      <template #default="{ row }">
        <el-input
          :model-value="row.title"
          maxlength="120"
          @update:model-value="
            (value: string) => updateDraft(row.key, { title: value })
          "
        />
      </template>
    </el-table-column>
    <el-table-column width="140">
      <template #header>
        <el-select
          v-if="props.batch && props.drafts.length > 1"
          :model-value="undefined"
          placeholder="资料类别 ▾"
          size="small"
          @update:model-value="setAllCategories"
        >
          <el-option
            v-for="item in props.docCategories"
            :key="item.key"
            :label="`全部设为${item.label}`"
            :value="item.key"
          />
        </el-select>
        <span v-else>资料类别</span>
      </template>
      <template #default="{ row }">
        <el-select
          :model-value="row.category"
          @update:model-value="
            (value: DocCategory) => updateDraft(row.key, { category: value })
          "
        >
          <el-option
            v-for="item in props.docCategories"
            :key="item.key"
            :label="item.label"
            :value="item.key"
          />
        </el-select>
      </template>
    </el-table-column>
    <el-table-column label="有效期至" width="160">
      <template #default="{ row }">
        <el-date-picker
          v-if="hasValidity(row.category)"
          :model-value="row.validUntil"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="可不填"
          style="width: 100%"
          @update:model-value="
            (value: string | null) =>
              updateDraft(row.key, { validUntil: value || null })
          "
        />
        <span v-else class="sub">不需要</span>
      </template>
    </el-table-column>
    <el-table-column width="60">
      <template #default="{ row }">
        <el-button link @click="removeDraft(row.key)">移除</el-button>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.file {
  word-break: break-all;
}

.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
