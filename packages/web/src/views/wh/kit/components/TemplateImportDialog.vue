<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { TemplateLineInput } from "@/api/wh/kit-types";
import { parseTable } from "../../shared/csv";
import { mapTemplateRows } from "../template-paste";

const props = defineProps<{ categories: { id: number; name: string }[] }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ imported: [rows: TemplateLineInput[]] }>();

const text = ref("");
watch(visible, open => {
  if (open) text.value = "";
});

const preview = computed(() =>
  mapTemplateRows(parseTable(text.value), props.categories)
);

const apply = () => {
  if (preview.value.errors.length > 0 || preview.value.rows.length === 0)
    return;
  emit("imported", preview.value.rows);
  visible.value = false;
};
</script>

<template>
  <el-dialog v-model="visible" title="粘贴模板行" width="760px" append-to-body>
    <p class="hint">
      从 Excel
      复制整张表（含表头）粘贴到下面。列名：分节、类型、品名、规格、单位、默认数量、设备类别、备注。
      类型填
      设备（或按台）、物资（或周转、消耗）、备忘；设备行要填设备类别。导入后会替换表格里现有的行，保存后才生效。
      计算规则可以多带七列：计算方式（固定、按总长、按最长一段、按段）、系数、另加、取整到（算出的数量向上取到它的倍数，比如
      50）、每套一份（是或否）、规格随管径（是或否）、标记（主机、发电、住宿）；不带这些列就都是固定。
    </p>
    <el-input
      v-model="text"
      type="textarea"
      :rows="10"
      placeholder="在这里粘贴"
    />
    <div class="summary">
      识别到 {{ preview.rows.length }} 行。有任何一行出错，这一批都不会进表格。
    </div>
    <el-alert
      v-for="error in preview.errors"
      :key="`${error.row}-${error.message}`"
      :title="
        error.row ? `第 ${error.row} 行：${error.message}` : error.message
      "
      type="error"
      :closable="false"
      class="error"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="preview.errors.length > 0 || preview.rows.length === 0"
        @click="apply"
        >放进表格</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.hint,
.summary {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.summary {
  margin: 8px 0;
}

.error {
  margin-top: 4px;
}
</style>
