<script setup lang="ts">
import { ref, watch } from "vue";

import { getDocFile } from "@/api/wh/doc-library";
import type { DocFileRow } from "@/api/wh/doc-library-types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../../shared/ids";
import { useWhAction } from "../../shared/useWhAction";
import { formatFileSize } from "../doc-view";

/** 一份资料的各个版本：现在这一版在最上面，下面是它替换掉的旧版。 */
const props = defineProps<{ docId: number | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ view: [row: DocFileRow] }>();

const { busy, run } = useWhAction();
const { loadUserNames, userNameOf } = useWecomUserOptions();
const rows = ref<DocFileRow[]>([]);

watch(visible, async open => {
  if (!open || props.docId === null) return;
  rows.value = [];
  void loadUserNames();
  const id = props.docId;
  const result = await run(() => getDocFile(id));
  if (!result || props.docId !== id) return;
  const { history, ...current } = result.data;
  rows.value = [current, ...history];
});
</script>

<template>
  <el-drawer v-model="visible" title="历史版本" size="720px">
    <el-table v-loading="busy" :data="rows" row-key="id" empty-text="没有记录">
      <el-table-column label="版本" width="90">
        <template #default="{ $index }">
          <el-tag v-if="$index === 0" type="success" size="small"
            >现在用的</el-tag
          >
          <el-tag v-else type="info" size="small">旧版本</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="文件" min-width="200">
        <template #default="{ row }">
          <div>{{ row.title }}</div>
          <div class="sub">
            {{ row.file_name }} · {{ formatFileSize(row.file_size) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="上传" width="190">
        <template #default="{ row }">
          <div>{{ userNameOf(row.uploaded_by_userid) }}</div>
          <div class="sub">{{ formatTime(row.created_at) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80">
        <template #default="{ row }">
          <el-button link type="primary" @click="emit('view', row)"
            >查看</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>
</template>

<style scoped>
.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
</style>
