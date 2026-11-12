<script setup lang="ts">
import type { DocCategory, DocLibraryConfig } from "@/api/wh/doc-library-types";
import type { DeviceCategory } from "@/api/wh/types";
import { formatFileSize, type DocOwner } from "../doc-view";
import OwnerPicker from "./OwnerPicker.vue";

/** 文件夹导入的预览：一个文件夹一行，定它归到哪里或者跳过；展开能改每个文件的资料类别。 */
export interface ImportGroupDraft {
  id: string;
  /** 文件夹名；空串是不在任何子文件夹里的散文件 */
  folder: string;
  matchedBy: "code" | "name" | null;
  owner: DocOwner;
  /** 对上的设备叫什么 */
  deviceLabel: string | null;
  skip: boolean;
  files: { key: string; file: File; title: string; category: DocCategory }[];
}

const props = defineProps<{
  groups: ImportGroupDraft[];
  categories: DeviceCategory[];
  docCategories: DocLibraryConfig["categories"];
}>();
const emit = defineEmits<{ change: [groups: ImportGroupDraft[]] }>();

const patchGroup = (id: string, change: Partial<ImportGroupDraft>) =>
  emit(
    "change",
    props.groups.map(group =>
      group.id === id ? { ...group, ...change } : group
    )
  );

const setCategory = (id: string, key: string, category: DocCategory) => {
  const group = props.groups.find(item => item.id === id);
  if (!group) return;
  patchGroup(id, {
    files: group.files.map(file =>
      file.key === key ? { ...file, category } : file
    )
  });
};

const MATCH_TEXT = { code: "按编号对上", name: "按名称对上" } as const;
</script>

<template>
  <el-table :data="props.groups" row-key="id" max-height="420">
    <el-table-column type="expand">
      <template #default="{ row }">
        <div class="files">
          <div v-for="file in row.files" :key="file.key" class="file-row">
            <span class="file-name" :title="file.file.name">{{
              file.file.name
            }}</span>
            <span class="sub">{{ formatFileSize(file.file.size) }}</span>
            <el-select
              :model-value="file.category"
              size="small"
              style="width: 130px"
              @update:model-value="
                (value: DocCategory) => setCategory(row.id, file.key, value)
              "
            >
              <el-option
                v-for="item in props.docCategories"
                :key="item.key"
                :label="item.label"
                :value="item.key"
              />
            </el-select>
          </div>
        </div>
      </template>
    </el-table-column>
    <el-table-column label="文件夹" min-width="200">
      <template #default="{ row }">
        <div class="folder" :class="{ skipped: row.skip }">
          {{ row.folder || "（没放在子文件夹里的文件）" }}
        </div>
        <div class="sub">{{ row.files.length }} 个文件</div>
      </template>
    </el-table-column>
    <el-table-column label="设备" width="130">
      <template #default="{ row }">
        <el-tag v-if="row.matchedBy" type="success" size="small">{{
          MATCH_TEXT[row.matchedBy as "code" | "name"]
        }}</el-tag>
        <template v-else-if="row.folder">
          <el-tag type="warning" size="small">没对上</el-tag>
          <div>
            <a href="#/wh/device" target="_blank" rel="noopener" class="link"
              >去新建设备</a
            >
          </div>
        </template>
        <span v-else class="sub">-</span>
      </template>
    </el-table-column>
    <el-table-column label="归到" min-width="300">
      <template #default="{ row }">
        <span v-if="row.skip" class="sub">这个文件夹不导入</span>
        <OwnerPicker
          v-else
          :model-value="row.owner"
          :categories="props.categories"
          :device-label="row.deviceLabel"
          @update:model-value="
            (value: DocOwner) => patchGroup(row.id, { owner: value })
          "
        />
      </template>
    </el-table-column>
    <el-table-column label="跳过" width="70">
      <template #default="{ row }">
        <el-checkbox
          :model-value="row.skip"
          @update:model-value="
            value => patchGroup(row.id, { skip: Boolean(value) })
          "
        />
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.files {
  padding: 4px 16px 4px 48px;
}

.file-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 4px 0;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder {
  word-break: break-all;
}

.folder.skipped {
  color: var(--el-text-color-secondary);
  text-decoration: line-through;
}

.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.link {
  font-size: 12px;
  color: var(--el-color-primary);
}
</style>
