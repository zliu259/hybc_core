<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ClauseTemplate,
  ContractDraftSection
} from "@/api/contract-draft";
import {
  requiredLevelLabelMap,
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
  (e: "reorder", orderedIds: number[]): void;
}>();

const addVisible = ref(false);
const addKey = ref("");
const addTableKey = ref("");
const customTitle = ref("");

// 清单表格节可独立添加（不限合同族）：跨族添加时后端降级为空白手动节并沿用变体，
// 前端渲染 TableEditor。仅在该 section_key 既不在条款库、也未存在时提供，避免与库内选项重复。
const TABLE_SECTION_DEFS = [
  {
    section_key: "equipment_schedule",
    variant_key: "default",
    title: "设备清单",
    label: "设备清单（湿租·含操作人员）"
  },
  {
    section_key: "equipment_schedule",
    variant_key: "dry_lease",
    title: "设备清单",
    label: "设备清单（干租）"
  },
  {
    section_key: "goods_spec",
    variant_key: "default",
    title: "材料/货物清单",
    label: "材料/货物清单"
  }
];
const standaloneTableOptions = computed(() => {
  const presentKeys = new Set(props.sections.map(s => s.section_key));
  const templateKeys = new Set(props.templates.map(t => t.section_key));
  return TABLE_SECTION_DEFS.filter(
    d => !presentKeys.has(d.section_key) && !templateKeys.has(d.section_key)
  ).map(d => ({ ...d, value: `${d.section_key}::${d.variant_key}` }));
});

// 已存在节的 section_key（无论哪个变体）整组隐藏；同 section_key 多变体逐变体成 option
const addable = computed(() =>
  props.templates.filter(
    t => !props.sections.some(s => s.section_key === t.section_key)
  )
);
const addableOptions = computed(() => {
  // label 常带必要级（核心/建议/可选）；同组 title 撞名（多变体）时再追加变体名消歧
  const titleCount = new Map<string, number>();
  for (const t of addable.value)
    titleCount.set(t.title, (titleCount.get(t.title) ?? 0) + 1);
  return addable.value.map(t => {
    const necessity =
      requiredLevelLabelMap[t.required_level] ?? t.required_level;
    const clash =
      t.variant_label !== "默认" && (titleCount.get(t.title) ?? 0) > 1;
    return {
      value: `${t.section_key}::${t.variant_key}`,
      label: clash
        ? `${t.title}（${t.variant_label}，${necessity}）`
        : `${t.title}（${necessity}）`
    };
  });
});

// HTML5 拖拽排序：drop 时本地计算新顺序，交由父组件持久化
const draggingId = ref<number | null>(null);
const onDragStart = (event: DragEvent, id: number) => {
  draggingId.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Firefox 需要 setData 才会启动拖拽
    event.dataTransfer.setData("text/plain", String(id));
  }
};
const onDrop = (targetId: number) => {
  const sourceId = draggingId.value;
  draggingId.value = null;
  if (sourceId == null || sourceId === targetId) return;
  const from = props.sections.findIndex(s => s.id === sourceId);
  const to = props.sections.findIndex(s => s.id === targetId);
  if (from < 0 || to < 0) return;
  const ordered = [...props.sections];
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  emit(
    "reorder",
    ordered.map(s => s.id)
  );
};

const submitAdd = () => {
  if (addKey.value) {
    const [sectionKey, variantKey] = addKey.value.split("::");
    emit("add", { section_key: sectionKey, variant_key: variantKey });
  } else if (addTableKey.value) {
    const def = standaloneTableOptions.value.find(
      d => d.value === addTableKey.value
    );
    if (def)
      emit("add", {
        section_key: def.section_key,
        variant_key: def.variant_key,
        title: def.title
      });
  } else if (customTitle.value.trim()) {
    emit("add", { title: customTitle.value.trim() });
  }
  addVisible.value = false;
  addKey.value = "";
  addTableKey.value = "";
  customTitle.value = "";
};
</script>

<template>
  <el-card class="toc-card">
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
        draggable="true"
        :class="{ active: s.id === activeId, dragging: s.id === draggingId }"
        @click="emit('select', s.id)"
        @dragstart="onDragStart($event, s.id)"
        @dragover.prevent
        @drop.prevent="onDrop(s.id)"
        @dragend="draggingId = null"
      >
        <span class="index">{{ idx + 1 }}.</span>
        <span class="title">{{ s.title }}</span>
        <span class="ops">
          <el-tag
            v-if="s.ai_status"
            size="small"
            :type="sectionAiStatusTagType[s.ai_status] ?? 'info'"
            :class="{ 'tag-generating': s.ai_status === 'generating' }"
          >
            {{ toDraftLabel(sectionAiStatusLabelMap, s.ai_status) }}
          </el-tag>
          <el-button
            link
            size="small"
            type="danger"
            class="del"
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
        <el-form-item v-if="standaloneTableOptions.length" label="或清单表格">
          <el-select
            v-model="addTableKey"
            clearable
            placeholder="独立添加设备/材料清单"
            style="width: 100%"
          >
            <el-option
              v-for="opt in standaloneTableOptions"
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
@keyframes tag-ellipsis {
  0% {
    content: "";
  }

  25% {
    content: ".";
  }

  50% {
    content: "..";
  }

  75%,
  100% {
    content: "...";
  }
}

/* 目录卡片在 sticky 容器内纵向 flex：header/添加按钮固定，条目区内滚 */
.toc-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.toc-card :deep(.el-card__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.section-list li {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 10px 9px;
  font-size: 14px;
  line-height: 1.6;
  cursor: grab;
  border-left: 3px solid transparent;
  border-radius: 3px;
}

.section-list li:hover {
  background: var(--el-fill-color-light);
}

.section-list li.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-left-color: var(--el-color-primary);
}

.section-list li.dragging {
  opacity: 0.5;
}

.section-list .index {
  min-width: 22px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
  text-align: right;
}

.section-list li.active .index {
  color: var(--el-color-primary);
}

.section-list .title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-list .ops {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
}

/* 删除按钮 hover 才显示，减少视觉噪音 */
.section-list .del {
  visibility: hidden;
}

.section-list li:hover .del {
  visibility: visible;
}

/* 生成中 tag：::after 定宽动画省略号（纯 CSS，不改数据流；定宽避免布局抖动） */
.tag-generating::after {
  display: inline-block;
  width: 1.1em;
  text-align: left;
  content: "";
  animation: tag-ellipsis 1.6s linear infinite;
}
</style>
