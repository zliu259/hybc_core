<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import type {
  StocktakeCountInput,
  StocktakeMaterialLineRow
} from "@/api/wh/stocktake-types";
import { message } from "@/utils/message";
import {
  diffText,
  filterMaterialLines,
  MATERIAL_FILTER_LABELS,
  materialCategories,
  parseCount,
  type MaterialFilter
} from "../stocktake-view";

/** 物资盘点表：逐行录实盘数。输入框失焦或回车就存；存不上时显示回原来的数。 */
const props = defineProps<{
  lines: StocktakeMaterialLineRow[];
  editable: boolean;
}>();
const emit = defineEmits<{
  /** 带 counted_qty 是录数（null 是清掉）；只带 note 是只改备注 */
  save: [lineId: number, data: StocktakeCountInput];
}>();

const PAGE_SIZE = 50;
const FILTERS = Object.keys(MATERIAL_FILTER_LABELS) as MaterialFilter[];

const filter = ref<MaterialFilter>("all");
const keyword = ref("");
const category = ref("");
const page = ref(1);
/** 正在改、还没存的字：行 id → 输入框里的字 */
const counts = reactive(new Map<number, string>());
const notes = reactive(new Map<number, string>());

const categories = computed(() => materialCategories(props.lines));
const filtered = computed(() =>
  filterMaterialLines(props.lines, filter.value, keyword.value, category.value)
);
const pageRows = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
);

watch([filter, keyword, category], () => {
  page.value = 1;
});

const countText = (line: StocktakeMaterialLineRow): string =>
  counts.get(line.id) ??
  (line.counted_qty === null ? "" : String(line.counted_qty));
const noteText = (line: StocktakeMaterialLineRow): string =>
  notes.get(line.id) ?? line.note ?? "";

const commitCount = (line: StocktakeMaterialLineRow) => {
  const draft = counts.get(line.id);
  if (draft === undefined) return;
  // 先丢掉草稿：存成功后显示接口返回的数，存不上就显示回原来的
  counts.delete(line.id);
  const parsed = parseCount(draft);
  if ("error" in parsed) {
    message(`${line.name}：${parsed.error}`, { type: "warning" });
    return;
  }
  if (parsed.value === line.counted_qty) return;
  emit("save", line.id, { counted_qty: parsed.value });
};

const commitNote = (line: StocktakeMaterialLineRow) => {
  const draft = notes.get(line.id);
  if (draft === undefined) return;
  notes.delete(line.id);
  if (draft.trim() === (line.note ?? "")) return;
  emit("save", line.id, { note: draft.trim() });
};
</script>

<template>
  <div>
    <div class="toolbar">
      <el-radio-group v-model="filter">
        <el-radio-button v-for="item in FILTERS" :key="item" :value="item">{{
          MATERIAL_FILTER_LABELS[item]
        }}</el-radio-button>
      </el-radio-group>
      <el-select
        v-model="category"
        clearable
        placeholder="全部类别"
        style="width: 160px"
      >
        <el-option
          v-for="item in categories"
          :key="item"
          :label="item"
          :value="item"
        />
      </el-select>
      <el-input
        v-model="keyword"
        clearable
        placeholder="品名、规格、编号"
        style="width: 220px"
      />
      <span class="count">共 {{ filtered.length }} 条</span>
    </div>
    <el-table :data="pageRows" row-key="id" size="small">
      <el-table-column prop="category" label="类别" width="120" />
      <el-table-column label="品名和规格" min-width="200">
        <template #default="{ row }">
          <div>{{ row.name }} {{ row.spec }}</div>
          <div class="sub">
            {{ row.material_code }}
            <template v-if="row.storage_note">
              · {{ row.storage_note }}</template
            >
          </div>
        </template>
      </el-table-column>
      <el-table-column label="账面数" width="110" align="right">
        <template #default="{ row }">
          <span class="nowrap"
            >{{ row.book_qty ?? row.current_qty }} {{ row.unit }}</span
          >
        </template>
      </el-table-column>
      <el-table-column label="实盘数" width="150">
        <template #default="{ row }">
          <el-input
            v-if="props.editable"
            :model-value="countText(row)"
            placeholder="没盘"
            inputmode="decimal"
            @update:model-value="(value: string) => counts.set(row.id, value)"
            @blur="commitCount(row)"
            @keyup.enter="commitCount(row)"
          />
          <span v-else>{{ row.counted_qty ?? "没盘" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="差额" width="90" align="right">
        <template #default="{ row }">
          <span
            :class="{
              loss: (row.diff ?? 0) < 0,
              gain: (row.diff ?? 0) > 0
            }"
            >{{ diffText(row) }}</span
          >
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="160">
        <template #default="{ row }">
          <el-input
            v-if="props.editable"
            :model-value="noteText(row)"
            maxlength="200"
            placeholder="可不填"
            @update:model-value="(value: string) => notes.set(row.id, value)"
            @blur="commitNote(row)"
            @keyup.enter="commitNote(row)"
          />
          <span v-else>{{ row.note ?? "" }}</span>
        </template>
      </el-table-column>
      <template #empty>没有符合条件的物资</template>
    </el-table>
    <div v-if="filtered.length > PAGE_SIZE" class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="filtered.length"
        layout="prev, pager, next"
      />
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.count,
.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.nowrap {
  white-space: nowrap;
}

.loss {
  color: var(--el-color-danger);
}

.gain {
  color: var(--el-color-success);
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
