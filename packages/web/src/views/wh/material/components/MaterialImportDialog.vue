<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { importMaterials } from "@/api/wh/material";
import type { ImportRowError } from "@/api/wh/types";
import { mapMaterialRows, parseTable } from "../../shared/csv";
import { batchRequestId, newClientRequestId } from "../../shared/ids";
import { useWhAction } from "../../shared/useWhAction";

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [] }>();

const BATCH = 200;
const { busy, run } = useWhAction();
const text = ref("");
const errors = ref<ImportRowError[]>([]);
const results = ref<string[]>([]);

// 每次打开对话框换一个；同一次打开里同样内容的批次沿用同一个请求号
let session = newClientRequestId();

watch(visible, open => {
  if (open) {
    session = newClientRequestId();
    text.value = "";
    errors.value = [];
    results.value = [];
  }
});

const preview = computed(() => mapMaterialRows(parseTable(text.value)));

const submit = async () => {
  const mapped = preview.value;
  if (mapped.errors.length > 0) {
    errors.value = mapped.errors;
    return;
  }
  errors.value = [];
  results.value = [];
  for (let start = 0; start < mapped.rows.length; start += BATCH) {
    const rows = mapped.rows.slice(start, start + BATCH);
    const result = await run(() =>
      importMaterials({
        client_request_id: batchRequestId(session, rows),
        rows
      })
    );
    if (!result) return;
    if (result.data.errors.length > 0) {
      errors.value = result.data.errors.map(e => ({
        row: e.row + start,
        message: e.message
      }));
      return;
    }
    const docNo = result.data.opening_doc_no;
    results.value = [
      ...results.value,
      `已导入 ${result.data.created} 条${docNo ? `，期初单号 ${docNo}` : ""}`
    ];
  }
  emit("imported");
};
</script>

<template>
  <el-dialog v-model="visible" title="导入物资" width="760px" destroy-on-close>
    <p class="hint">
      从 Excel
      复制整张表（含表头）粘贴到下面。列名：品名、规格、单位、分节、管法、期初数量、单价、最低库存、库位、备注。品名、单位、分节、管法必填；管法填
      周转 或 消耗。
    </p>
    <el-input
      v-model="text"
      type="textarea"
      :rows="10"
      placeholder="在这里粘贴"
    />
    <p class="hint">
      识别到 {{ preview.rows.length }} 行。有任何一行出错，这一批都不会导入。
    </p>
    <el-alert
      v-for="line in results"
      :key="line"
      :title="line"
      type="success"
      :closable="false"
    />
    <el-table
      v-if="errors.length > 0"
      :data="errors"
      size="small"
      max-height="240"
    >
      <el-table-column prop="row" label="行号" width="80" />
      <el-table-column prop="message" label="问题" />
    </el-table>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="preview.rows.length === 0 && preview.errors.length === 0"
        @click="submit"
      >
        导入
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin: 8px 0;
}
</style>
