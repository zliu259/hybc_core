<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  computeRowAmount,
  computeTableTotal,
  emptyRow,
  formatMoney,
  getPresetColumns,
  parseTable,
  presetLabel,
  serializeTable,
  validateTable,
  type ContractTable,
  type TableColumn,
  type TablePreset,
  type TableRow
} from "../lib/table-presets";

const props = defineProps<{
  preset: TablePreset;
  modelValue: string | null;
  /** 合同总价（关键字 amount）：用于「合计 vs 合同总价」一致性徽标 */
  contractAmount?: number;
  readonly?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ (e: "save", tableJson: string): void }>();

const columns = computed(() => getPresetColumns(props.preset));
const rows = ref<TableRow[]>([]);

const loadFromModel = () => {
  const parsed = parseTable(props.modelValue);
  rows.value =
    parsed && parsed.preset === props.preset
      ? parsed.rows.map(r => ({ ...r }))
      : [];
};
loadFromModel();
// modelValue 变化（父保存后回填 / 外部载入）时重载；同一字符串不触发，保护编辑中状态。
watch(
  () => props.modelValue,
  () => loadFromModel()
);

const currentTable = computed<ContractTable>(() => ({
  preset: props.preset,
  rows: rows.value
}));
const total = computed(() => computeTableTotal(currentTable.value));
const errors = computed(() => validateTable(currentTable.value));

// 脏标记：当前序列化 ≠ 已保存序列化
const savedJson = computed(() => {
  const parsed = parseTable(props.modelValue);
  return parsed && parsed.preset === props.preset
    ? serializeTable(parsed)
    : serializeTable({ preset: props.preset, rows: [] });
});
const dirty = computed(
  () => serializeTable(currentTable.value) !== savedJson.value
);

// 一致性徽标：合计 vs 合同总价（两位小数容差）
const amountMatch = computed<"none" | "match" | "mismatch">(() => {
  const amt = props.contractAmount;
  if (!amt || !Number.isFinite(amt) || amt <= 0 || rows.value.length === 0)
    return "none";
  return Math.abs(total.value - amt) < 0.01 ? "match" : "mismatch";
});

// 编辑器列宽按类型收窄（文本类靠多行 textarea 换行，无需拉宽）；docx 预设 width 不受影响。
const TYPE_MIN_WIDTH: Record<TableColumn["type"], number> = {
  seq: 48,
  number: 76,
  money: 96,
  amount: 104,
  enum: 116,
  text: 120
};
const colMinWidth = (type: TableColumn["type"]): number => TYPE_MIN_WIDTH[type];
const cellHasError = (rowIndex: number, colKey: string): boolean =>
  errors.value.some(e => e.rowIndex === rowIndex && e.colKey === colKey);

// 单元格取值/写值：TableRow 的值是 string|number|boolean|undefined，
// 按控件所需类型收窄，避免 as any（保存时 serializeTable 已按列剔除空值）。
const strOf = (v: TableRow[string]): string =>
  v === undefined ? "" : String(v);
const numOf = (v: TableRow[string]): number | undefined =>
  typeof v === "number" ? v : undefined;
const setCell = (
  row: TableRow,
  key: string,
  v: string | number | undefined
): void => {
  row[key] = v;
};

const addRow = () => {
  rows.value = [...rows.value, emptyRow(props.preset)];
};
const removeRow = (index: number) => {
  rows.value = rows.value.filter((_, i) => i !== index);
};
const moveRow = (index: number, delta: number) => {
  const target = index + delta;
  if (target < 0 || target >= rows.value.length) return;
  const next = [...rows.value];
  [next[index], next[target]] = [next[target], next[index]];
  rows.value = next;
};

const onSave = async () => {
  if (errors.value.length > 0) {
    try {
      await ElMessageBox.confirm(
        `清单有 ${errors.value.length} 处必填项未填（含「是否含操作人员」等税务合规关键列），仍要保存吗？`,
        "清单未填完整",
        {
          type: "warning",
          confirmButtonText: "仍然保存",
          cancelButtonText: "返回填写"
        }
      );
    } catch {
      return;
    }
  }
  emit("save", serializeTable(currentTable.value));
  ElMessage.success("已保存清单");
};
</script>

<template>
  <div class="table-editor">
    <div class="te-head">
      <span class="te-title">{{ presetLabel(preset) }}</span>
      <el-tag v-if="errors.length" size="small" type="danger" effect="light">
        {{ errors.length }} 处必填未完成
      </el-tag>
    </div>

    <el-table
      :data="rows"
      size="small"
      border
      class="te-table"
      empty-text="暂无清单行，点击下方「新增一行」"
    >
      <el-table-column
        v-for="col in columns"
        :key="col.key"
        :label="col.label"
        :min-width="colMinWidth(col.type)"
      >
        <template #default="{ row, $index }">
          <span v-if="col.type === 'seq'" class="te-seq">{{ $index + 1 }}</span>
          <span v-else-if="col.type === 'amount'" class="te-amount">
            {{ formatMoney(computeRowAmount(row)) }}
          </span>
          <template v-else-if="readonly">
            <span>{{
              row[col.key] === undefined || row[col.key] === ""
                ? "—"
                : row[col.key]
            }}</span>
          </template>
          <el-select
            v-else-if="col.type === 'enum'"
            :model-value="strOf(row[col.key])"
            size="small"
            placeholder="选择"
            :class="{ 'te-cell-error': cellHasError($index, col.key) }"
            @update:model-value="v => setCell(row, col.key, v)"
          >
            <el-option
              v-for="opt in col.options"
              :key="opt"
              :value="opt"
              :label="opt"
            />
          </el-select>
          <el-input-number
            v-else-if="col.type === 'number' || col.type === 'money'"
            :model-value="numOf(row[col.key])"
            size="small"
            :controls="false"
            :min="0"
            :precision="col.type === 'money' ? 2 : undefined"
            :class="{ 'te-cell-error': cellHasError($index, col.key) }"
            @update:model-value="v => setCell(row, col.key, v ?? undefined)"
          />
          <el-input
            v-else
            :model-value="strOf(row[col.key])"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            resize="none"
            size="small"
            :placeholder="col.placeholder"
            :class="{ 'te-cell-error': cellHasError($index, col.key) }"
            @update:model-value="v => setCell(row, col.key, v)"
          />
        </template>
      </el-table-column>

      <el-table-column v-if="!readonly" label="操作" width="120" fixed="right">
        <template #default="{ $index }">
          <el-button
            link
            size="small"
            :disabled="$index === 0"
            @click="moveRow($index, -1)"
            >↑</el-button
          >
          <el-button
            link
            size="small"
            :disabled="$index === rows.length - 1"
            @click="moveRow($index, 1)"
            >↓</el-button
          >
          <el-button link size="small" type="danger" @click="removeRow($index)"
            >删</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <div class="te-foot">
      <div class="te-total">
        合计：<span class="te-total-amount">¥{{ formatMoney(total) }}</span>
        <el-tag
          v-if="amountMatch === 'match'"
          size="small"
          type="success"
          effect="light"
          >= 合同总价</el-tag
        >
        <el-tag
          v-else-if="amountMatch === 'mismatch'"
          size="small"
          type="danger"
          effect="light"
        >
          ≠ 合同总价 ¥{{ formatMoney(contractAmount ?? 0) }}
        </el-tag>
      </div>
      <div v-if="!readonly" class="te-actions">
        <el-button size="small" :disabled="busy" @click="addRow"
          >＋ 新增一行</el-button
        >
        <el-button
          size="small"
          type="primary"
          :disabled="!dirty || busy"
          @click="onSave"
          >保存清单</el-button
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-editor {
  padding: 10px;
  margin-top: 10px;
  background: var(--el-fill-color-lighter);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}

.te-head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.te-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.te-table {
  width: 100%;
}

.te-seq {
  color: var(--el-text-color-secondary);
}

.te-amount {
  font-variant-numeric: tabular-nums;
}

.te-cell-error :deep(.el-input__wrapper),
.te-cell-error :deep(.el-select__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.te-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.te-total {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}

.te-total-amount {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.te-actions {
  display: flex;
  gap: 8px;
}
</style>
