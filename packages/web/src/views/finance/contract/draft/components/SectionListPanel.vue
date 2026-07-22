<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ClauseTemplate,
  ContractDraftSection
} from "@/api/contract-draft";
import {
  sectionAiStatusLabelMap,
  sectionAiStatusTagType,
  toDraftLabel
} from "../draft-labels";

const props = defineProps<{
  sections: ContractDraftSection[];
  templates: ClauseTemplate[];
  activeId: number | null;
}>();
const emit = defineEmits<{
  (e: "select", id: number): void;
  (
    e: "add",
    payload: { section_key?: string; title?: string; variant_key?: string }
  ): void;
  (e: "remove", id: number): void;
  (e: "move", payload: { id: number; delta: -1 | 1 }): void;
}>();

const addVisible = ref(false);
const addKey = ref("");
const customTitle = ref("");

// 已存在节的 section_key（无论哪个变体）整组隐藏；同 section_key 多变体逐变体成 option
const addable = computed(() =>
  props.templates.filter(
    t => !props.sections.some(s => s.section_key === t.section_key)
  )
);
const addableOptions = computed(() => {
  // 变体行在条款库中的 title 通常已自带区分后缀；仅当同组 title 撞名时才追加（变体名）消歧
  const titleCount = new Map<string, number>();
  for (const t of addable.value)
    titleCount.set(t.title, (titleCount.get(t.title) ?? 0) + 1);
  return addable.value.map(t => ({
    value: `${t.section_key}::${t.variant_key}`,
    label:
      t.variant_label !== "默认" && (titleCount.get(t.title) ?? 0) > 1
        ? `${t.title}（${t.variant_label}）`
        : t.title
  }));
});

const submitAdd = () => {
  if (addKey.value) {
    const [sectionKey, variantKey] = addKey.value.split("::");
    emit("add", { section_key: sectionKey, variant_key: variantKey });
  } else if (customTitle.value.trim()) {
    emit("add", { title: customTitle.value.trim() });
  }
  addVisible.value = false;
  addKey.value = "";
  customTitle.value = "";
};
</script>

<template>
  <el-card>
    <template #header>
      <div class="panel-header">
        <span>合同条款（{{ sections.length }} 节）</span>
        <el-button size="small" type="primary" plain @click="addVisible = true"
          >添加节</el-button
        >
      </div>
    </template>
    <ul class="section-list">
      <li
        v-for="(s, idx) in sections"
        :key="s.id"
        :class="{ active: s.id === activeId }"
        @click="emit('select', s.id)"
      >
        <span class="title">{{ s.title }}</span>
        <span class="ops">
          <el-tag
            v-if="s.ai_status"
            size="small"
            :type="sectionAiStatusTagType[s.ai_status] ?? 'info'"
          >
            {{ toDraftLabel(sectionAiStatusLabelMap, s.ai_status) }}
          </el-tag>
          <el-button
            link
            size="small"
            :disabled="idx === 0"
            @click.stop="emit('move', { id: s.id, delta: -1 })"
            >↑</el-button
          >
          <el-button
            link
            size="small"
            :disabled="idx === sections.length - 1"
            @click.stop="emit('move', { id: s.id, delta: 1 })"
            >↓</el-button
          >
          <el-button
            link
            size="small"
            type="danger"
            @click.stop="emit('remove', s.id)"
            >删</el-button
          >
        </span>
      </li>
    </ul>
    <el-dialog
      v-model="addVisible"
      title="添加条款节"
      width="420px"
      append-to-body
    >
      <el-form label-width="80px">
        <el-form-item label="从条款库">
          <el-select
            v-model="addKey"
            clearable
            placeholder="选择条款节"
            style="width: 100%"
          >
            <el-option
              v-for="opt in addableOptions"
              :key="opt.value"
              :value="opt.value"
              :label="opt.label"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="或自定义">
          <el-input
            v-model="customTitle"
            maxlength="120"
            placeholder="自定义节标题"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAdd">添加</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.section-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
}
.section-list li.active {
  background: var(--el-color-primary-light-9);
}
.section-list .title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-list .ops {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
