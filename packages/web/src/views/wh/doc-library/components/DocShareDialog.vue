<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { ref, watch } from "vue";

import {
  createDocShare,
  listDocShares,
  revokeDocShare
} from "@/api/wh/doc-library";
import type { DocFileRow, DocShareRow } from "@/api/wh/doc-library-types";
import { normalizeApiUrl } from "@/utils/api-url";
import { message } from "@/utils/message";
import { formatTime } from "../../shared/ids";
import { useWhAction } from "../../shared/useWhAction";
import { shareStatus } from "../doc-view";

/** 对外链接：给一个文件生成限时的下载地址，发给公司外面的人；可以随时作废。 */
const props = defineProps<{ doc: DocFileRow | null }>();
const visible = defineModel<boolean>({ required: true });

const DEFAULT_DAYS = 7;
const { busy, run } = useWhAction();
const days = ref(DEFAULT_DAYS);
const rows = ref<DocShareRow[]>([]);

/** 发给外面的人的地址和网页走同一个入口 */
const publicUrl = (row: DocShareRow): string => normalizeApiUrl(row.url);

const load = async () => {
  const doc = props.doc;
  if (!doc) return;
  const result = await run(() => listDocShares(doc.id));
  if (result && props.doc?.id === doc.id) rows.value = result.data;
};

watch(visible, open => {
  if (!open) return;
  days.value = DEFAULT_DAYS;
  rows.value = [];
  void load();
});

const copy = async (row: DocShareRow) => {
  try {
    await navigator.clipboard.writeText(publicUrl(row));
    message("已复制链接", { type: "success" });
  } catch {
    message("复制不了，请手动选中链接复制", { type: "warning" });
  }
};

const create = async () => {
  const doc = props.doc;
  if (!doc) return;
  const result = await run(() => createDocShare(doc.id, days.value));
  if (!result) return;
  rows.value = [result.data, ...rows.value];
  message("已生成。拿到链接的人不用登录就能下载这一个文件。", {
    type: "success"
  });
};

const revoke = async (row: DocShareRow) => {
  try {
    await ElMessageBox.confirm(
      "作废后这个链接马上打不开，已经发出去的也一样。",
      "作废这个链接？",
      { type: "warning", confirmButtonText: "作废", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  await run(() => revokeDocShare(row.token), { success: "已作废" });
  await load();
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`对外链接：${props.doc?.title ?? ''}`"
    width="820px"
    destroy-on-close
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      class="block"
      title="拿到链接的人不用登录就能下载这一个文件，别发到不该看的地方。文件被替换或删除后，链接自动失效。"
    />
    <div class="create">
      <span>有效</span>
      <el-input-number
        v-model="days"
        :min="1"
        :max="30"
        :step="1"
        step-strictly
        controls-position="right"
        style="width: 110px"
      />
      <span>天</span>
      <el-button type="primary" :loading="busy" @click="create"
        >生成链接</el-button
      >
    </div>
    <el-table
      v-loading="busy"
      :data="rows"
      row-key="id"
      empty-text="还没有生成过链接"
      max-height="360"
    >
      <el-table-column label="链接" min-width="260">
        <template #default="{ row }">
          <div class="url" :class="{ dead: !row.active }">
            {{ publicUrl(row) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="到期" width="170">
        <template #default="{ row }">{{ formatTime(row.expires_at) }}</template>
      </el-table-column>
      <el-table-column label="下载次数" width="90" prop="access_count" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="shareStatus(row).type" size="small">{{
            shareStatus(row).text
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140">
        <template #default="{ row }">
          <template v-if="row.active">
            <el-button link type="primary" @click="copy(row)"
              >复制链接</el-button
            >
            <el-button link type="danger" @click="revoke(row)">作废</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<style scoped>
.block {
  margin-bottom: 12px;
}

.create {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.url {
  font-family: var(--el-font-family-monospace, monospace);
  font-size: 12px;
  word-break: break-all;
  user-select: all;
}

.url.dead {
  color: var(--el-text-color-placeholder);
  text-decoration: line-through;
}
</style>
