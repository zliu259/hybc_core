<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { importDevices } from "@/api/wh/device";
import type { DeviceImportRow, ImportRowError } from "@/api/wh/types";
import { mapDeviceRows, parseTable } from "../../shared/csv";
import { batchRequestId, newClientRequestId } from "../../shared/ids";
import { useWhAction } from "../../shared/useWhAction";

const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [] }>();

const BATCH = 200;
const COLUMNS =
  "编号、名称、现场叫法、类别、机型、口径、厂家、型号、出厂编号、规格、所在项目、库位、备注";
const { busy, run } = useWhAction();
const text = ref("");
const errors = ref<ImportRowError[]>([]);
const done = ref(0);

// 每次打开对话框换一个；同一次打开里同样内容的批次沿用同一个请求号
let session = newClientRequestId();

watch(visible, open => {
  if (open) {
    session = newClientRequestId();
    text.value = "";
    errors.value = [];
    done.value = 0;
  }
});

const preview = computed(() => mapDeviceRows(parseTable(text.value)));

const submit = async () => {
  const mapped = preview.value;
  if (mapped.errors.length > 0) {
    errors.value = mapped.errors;
    return;
  }
  errors.value = [];
  done.value = 0;
  for (let start = 0; start < mapped.rows.length; start += BATCH) {
    const rows: DeviceImportRow[] = mapped.rows.slice(start, start + BATCH);
    const result = await run(() =>
      importDevices({ client_request_id: batchRequestId(session, rows), rows })
    );
    if (!result) return;
    if (result.data.errors.length > 0) {
      errors.value = result.data.errors.map(e => ({
        row: e.row + start,
        message: e.message
      }));
      return;
    }
    done.value += result.data.created;
  }
  emit("imported");
};
</script>

<template>
  <el-dialog v-model="visible" title="导入设备" width="760px" destroy-on-close>
    <p class="hint">
      从 Excel 复制整张表（含表头）粘贴到下面。列名：{{
        COLUMNS
      }}。名称和类别必填，类别不存在会自动新建。
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
      v-if="done > 0"
      :title="`已导入 ${done} 台设备`"
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
