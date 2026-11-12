<script setup lang="ts">
import { computed, onMounted } from "vue";

import type {
  DocCategory,
  DocFileRow,
  DocLibraryConfig
} from "@/api/wh/doc-library-types";
import type { WarehouseCapabilities } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../../shared/ids";
import { mirrorTag, type MirrorTag } from "../../settings/wedrive-view";
import {
  docActions,
  formatFileSize,
  ownerText,
  validityTag
} from "../doc-view";

/**
 * 资料列表。能做哪些操作由 docActions 决定：旧版本和没有权限的人只有「查看」。
 * 微盘的同步状态和「重新同步」只在 showMirror 时出现：建过微盘空间，并且看的人是库管或资料管理员。
 * 状态写在标题那一格里，不单独占一列：1440 宽的屏幕上再加一列，表格就要横着滚了。
 */
const props = defineProps<{
  rows: DocFileRow[];
  caps: WarehouseCapabilities | null;
  docCategories: DocLibraryConfig["categories"];
  showMirror?: boolean;
}>();
const emit = defineEmits<{
  view: [row: DocFileRow];
  edit: [row: DocFileRow];
  history: [row: DocFileRow];
  replace: [row: DocFileRow];
  share: [row: DocFileRow];
  remove: [row: DocFileRow];
  remirror: [row: DocFileRow];
}>();

const { loadUserNames, userNameOf } = useWecomUserOptions();

const categoryLabels = computed(
  () => new Map(props.docCategories.map(item => [item.key, item.label]))
);
const categoryLabel = (key: DocCategory): string =>
  categoryLabels.value.get(key) ?? "其他";

/** 这一行的微盘状态；不该显示时是 null */
const mirrorOf = (row: DocFileRow): MirrorTag | null =>
  props.showMirror ? mirrorTag(row) : null;

const onCommand = (command: string, row: DocFileRow) => {
  if (command === "history") emit("history", row);
  else if (command === "replace") emit("replace", row);
  else if (command === "share") emit("share", row);
  else if (command === "remove") emit("remove", row);
  else if (command === "remirror") emit("remirror", row);
};

onMounted(() => void loadUserNames());
</script>

<template>
  <el-table :data="props.rows" row-key="id" empty-text="没有资料">
    <el-table-column label="标题" min-width="220">
      <template #default="{ row }">
        <el-link type="primary" @click="emit('view', row)">{{
          row.title
        }}</el-link>
        <el-tag v-if="!row.is_latest" type="info" size="small" class="tag"
          >旧版本</el-tag
        >
        <el-tooltip
          v-if="mirrorOf(row) && mirrorOf(row)!.type !== 'success'"
          :content="mirrorOf(row)!.tip"
          :disabled="!mirrorOf(row)!.tip"
          placement="top"
        >
          <el-tag :type="mirrorOf(row)!.type" size="small" class="tag"
            >微盘：{{ mirrorOf(row)!.text }}</el-tag
          >
        </el-tooltip>
        <div class="sub">
          {{ row.file_name }} ·
          <span class="nowrap">{{ formatFileSize(row.file_size) }}</span>
          <span v-if="mirrorOf(row)?.type === 'success'" class="nowrap">
            · 微盘已同步</span
          >
        </div>
      </template>
    </el-table-column>
    <el-table-column label="资料类别" width="100">
      <template #default="{ row }">{{
        categoryLabel(row.doc_category)
      }}</template>
    </el-table-column>
    <el-table-column label="归属" min-width="150">
      <template #default="{ row }">{{ ownerText(row) }}</template>
    </el-table-column>
    <el-table-column label="上传" width="160">
      <template #default="{ row }">
        <div>{{ userNameOf(row.uploaded_by_userid) }}</div>
        <div class="sub">{{ formatTime(row.created_at) }}</div>
      </template>
    </el-table-column>
    <el-table-column label="有效期至" width="120">
      <template #default="{ row }">
        <div>{{ row.valid_until ?? "-" }}</div>
        <el-tag
          v-if="validityTag(row.validity)"
          :type="validityTag(row.validity)!.type"
          size="small"
          >{{ validityTag(row.validity)!.text }}</el-tag
        >
      </template>
    </el-table-column>
    <el-table-column label="操作" width="150" fixed="right">
      <template #default="{ row }">
        <el-button link type="primary" @click="emit('view', row)"
          >查看</el-button
        >
        <el-button
          v-if="docActions(row, props.caps).canEdit"
          link
          type="primary"
          @click="emit('edit', row)"
          >改</el-button
        >
        <el-dropdown
          v-if="
            row.supersedes_id !== null || docActions(row, props.caps).canDelete
          "
          trigger="click"
          class="more"
          @command="(command: string) => onCommand(command, row)"
        >
          <el-button link type="primary">更多</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-if="docActions(row, props.caps).canReplace"
                command="replace"
                >替换文件</el-dropdown-item
              >
              <el-dropdown-item
                v-if="docActions(row, props.caps).canShare"
                command="share"
                >对外链接</el-dropdown-item
              >
              <el-dropdown-item
                v-if="row.supersedes_id !== null"
                command="history"
                >历史版本</el-dropdown-item
              >
              <el-dropdown-item
                v-if="
                  props.showMirror && docActions(row, props.caps).canRemirror
                "
                command="remirror"
                >重新同步到微盘</el-dropdown-item
              >
              <el-dropdown-item
                v-if="docActions(row, props.caps).canDelete"
                command="remove"
                divided
                >删除</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.tag {
  margin-left: 6px;
}

.nowrap {
  white-space: nowrap;
}

.sub {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}

.more {
  margin-left: 12px;
  vertical-align: middle;
}
</style>
