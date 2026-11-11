<script setup lang="ts">
import { computed, ref } from "vue";

import type { KitFulfilmentLine } from "@/api/wh/kit-types";
import { listMaterials } from "@/api/wh/material";
import type { Material } from "@/api/wh/types";
import {
  KIT_LINE_KIND_LABELS,
  KIT_SOURCE_LABELS,
  newEditableLine,
  type EditableKitLine
} from "../kit-view";

const props = defineProps<{
  mode: "template" | "kit";
  categories: { id: number; name: string }[];
  readonly: boolean;
  /** 已确认的清单只读时显示已发、待发、在库 */
  fulfilment?: KitFulfilmentLine[];
  /** 提交前检查出的问题行（下标） */
  problems?: { index: number; message: string }[];
}>();
const lines = defineModel<EditableKitLine[]>({ required: true });

const KINDS = Object.entries(KIT_LINE_KIND_LABELS) as [
  EditableKitLine["line_kind"],
  string
][];
const SOURCES = Object.entries(KIT_SOURCE_LABELS) as [
  EditableKitLine["source"],
  string
][];

const problemByIndex = computed(
  () =>
    new Map(
      (props.problems ?? []).map(problem => [problem.index, problem.message])
    )
);
const fulfilmentById = computed(
  () => new Map((props.fulfilment ?? []).map(line => [line.id, line]))
);
const categoryName = (id: number | null) =>
  props.categories.find(category => category.id === id)?.name ?? "";

// 物资选择：先给同品名的规格，输入关键字后远程搜
const searchResults = ref<Material[]>([]);
const searching = ref(false);
const searchMaterials = async (keyword: string) => {
  if (!keyword.trim()) {
    searchResults.value = [];
    return;
  }
  searching.value = true;
  try {
    searchResults.value = (
      await listMaterials({ keyword, status: "active", pageSize: 30 })
    ).data;
  } catch {
    searchResults.value = [];
  } finally {
    searching.value = false;
  }
};
const materialOptions = (row: EditableKitLine) => {
  const choices = row.spec_choices.map(choice => ({
    id: choice.id,
    label: [row.name_text, choice.spec].filter(Boolean).join(" ")
  }));
  const found = searchResults.value
    .filter(material => !choices.some(choice => choice.id === material.id))
    .map(material => ({
      id: material.id,
      label: [material.name, material.spec].filter(Boolean).join(" ")
    }));
  const current =
    row.material_id &&
    ![...choices, ...found].some(option => option.id === row.material_id)
      ? [{ id: row.material_id, label: row.material_label }]
      : [];
  return [...current, ...choices, ...found];
};
const pickMaterial = (row: EditableKitLine, id: number | null) => {
  const material = searchResults.value.find(item => item.id === id);
  const choice = row.spec_choices.find(item => item.id === id);
  const label = material
    ? [material.name, material.spec].filter(Boolean).join(" ")
    : choice
      ? [row.name_text, choice.spec].filter(Boolean).join(" ")
      : "";
  lines.value = lines.value.map(line =>
    line.key === row.key
      ? {
          ...line,
          material_id: id,
          material_label: label,
          name_text: material?.name ?? line.name_text,
          unit: line.unit || material?.unit || ""
        }
      : line
  );
};

const addLine = () => {
  const last = lines.value[lines.value.length - 1];
  lines.value = [...lines.value, newEditableLine(last?.section ?? "")];
};
const removeLine = (key: string) => {
  lines.value = lines.value.filter(line => line.key !== key);
};
const rowClass = ({ rowIndex }: { rowIndex: number }) =>
  problemByIndex.value.has(rowIndex) ? "problem-row" : "";
const fmt = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : value;
</script>

<template>
  <div>
    <el-table
      :data="lines"
      row-key="key"
      size="small"
      border
      :row-class-name="rowClass"
    >
      <el-table-column label="#" width="50" type="index" />
      <el-table-column label="分节" width="120">
        <template #default="{ row }">
          <span v-if="props.readonly">{{ row.section }}</span>
          <el-input v-else v-model="row.section" maxlength="20" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <span v-if="props.readonly">{{
            KIT_LINE_KIND_LABELS[row.line_kind]
          }}</span>
          <el-select v-else v-model="row.line_kind">
            <el-option
              v-for="[value, label] in KINDS"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="品名和规格" min-width="260">
        <template #default="{ row, $index }">
          <template v-if="props.mode === 'kit' && row.line_kind === 'material'">
            <span v-if="props.readonly">{{
              row.material_label || row.name_text
            }}</span>
            <el-select
              v-else
              :model-value="row.material_id"
              filterable
              remote
              clearable
              :remote-method="searchMaterials"
              :loading="searching"
              :placeholder="`待选规格：${row.name_text || '输入品名搜索'}`"
              style="width: 100%"
              @update:model-value="
                (id: number | null) => pickMaterial(row, id ?? null)
              "
            >
              <el-option
                v-for="option in materialOptions(row)"
                :key="option.id"
                :label="option.label"
                :value="option.id"
              />
            </el-select>
          </template>
          <template v-else>
            <span v-if="props.readonly"
              >{{ row.name_text }} {{ row.spec_text }}</span
            >
            <div v-else class="name-spec">
              <el-input
                v-model="row.name_text"
                maxlength="60"
                placeholder="品名"
              />
              <el-input
                v-model="row.spec_text"
                maxlength="60"
                placeholder="规格"
              />
            </div>
          </template>
          <div v-if="problemByIndex.has($index)" class="problem">
            {{ problemByIndex.get($index) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="设备类别" width="130">
        <template #default="{ row }">
          <template v-if="row.line_kind === 'device'">
            <span v-if="props.readonly">{{
              categoryName(row.device_category_id)
            }}</span>
            <el-select
              v-else
              v-model="row.device_category_id"
              placeholder="选类别"
            >
              <el-option
                v-for="category in props.categories"
                :key="category.id"
                :label="category.name"
                :value="category.id"
              />
            </el-select>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="80">
        <template #default="{ row }">
          <span v-if="props.readonly">{{ row.unit }}</span>
          <el-input v-else v-model="row.unit" maxlength="10" />
        </template>
      </el-table-column>
      <el-table-column
        :label="props.mode === 'kit' ? '计划' : '默认数量'"
        width="120"
      >
        <template #default="{ row }">
          <span v-if="props.readonly">{{ fmt(row.qty) }}</span>
          <el-input-number
            v-else
            v-model="row.qty"
            :min="0"
            :precision="row.line_kind === 'device' ? 0 : undefined"
            :controls="false"
            style="width: 100%"
          />
        </template>
      </el-table-column>
      <el-table-column v-if="props.mode === 'kit'" label="来源" width="110">
        <template #default="{ row }">
          <span v-if="props.readonly">{{ KIT_SOURCE_LABELS[row.source] }}</span>
          <el-select v-else v-model="row.source">
            <el-option
              v-for="[value, label] in SOURCES"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </template>
      </el-table-column>
      <template v-if="props.fulfilment">
        <el-table-column label="已发" width="80" align="right">
          <template #default="{ row }">{{
            fmt(fulfilmentById.get(row.id)?.shipped)
          }}</template>
        </el-table-column>
        <el-table-column label="待发" width="80" align="right">
          <template #default="{ row }">
            <span
              :class="{
                pending: (fulfilmentById.get(row.id)?.pending ?? 0) > 0
              }"
              >{{ fmt(fulfilmentById.get(row.id)?.pending) }}</span
            >
          </template>
        </el-table-column>
        <el-table-column label="在库" width="80" align="right">
          <template #default="{ row }">{{
            fmt(fulfilmentById.get(row.id)?.in_stock)
          }}</template>
        </el-table-column>
      </template>
      <el-table-column label="备注" min-width="140">
        <template #default="{ row }">
          <span v-if="props.readonly">{{ row.note }}</span>
          <el-input v-else v-model="row.note" maxlength="200" />
        </template>
      </el-table-column>
      <el-table-column v-if="!props.readonly" label="" width="60">
        <template #default="{ row }">
          <el-button link type="danger" @click="removeLine(row.key)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>
    <el-button v-if="!props.readonly" class="add" @click="addLine"
      >加一行</el-button
    >
  </div>
</template>

<style scoped>
.name-spec {
  display: flex;
  gap: 6px;
}

.problem {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.pending {
  font-weight: 600;
  color: var(--el-color-warning);
}

.add {
  margin-top: 8px;
}

:deep(.problem-row) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}
</style>
