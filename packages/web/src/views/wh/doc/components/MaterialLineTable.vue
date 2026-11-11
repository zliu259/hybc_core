<script setup lang="ts">
import { ref } from "vue";

import { listMaterials } from "@/api/wh/material";
import type { Material } from "@/api/wh/types";
import type { DocFormType, DocMaterialLine } from "../doc-form-model";

const props = defineProps<{ docType: DocFormType; allowAdd: boolean }>();
const lines = defineModel<DocMaterialLine[]>({ required: true });

const options = ref<Material[]>([]);
const picking = ref<number | undefined>();

const search = async (keyword: string) => {
  try {
    const result = await listMaterials({
      keyword: keyword || undefined,
      status: "active",
      pageSize: 30
    });
    options.value = result.data.filter(
      m => props.docType !== "back" || m.kind === "consumable"
    );
  } catch {
    options.value = [];
  }
};

const add = (id: number) => {
  const m = options.value.find(item => item.id === id);
  picking.value = undefined;
  if (!m || lines.value.some(line => line.material_id === m.id)) return;
  lines.value = [
    ...lines.value,
    {
      material_id: m.id,
      name: m.name,
      spec: m.spec,
      unit: m.unit,
      kind: m.kind,
      available: props.docType === "out" ? m.quantity : null,
      returned: "",
      lost: "",
      quantity: ""
    }
  ];
};

const remove = (index: number) => {
  lines.value = lines.value.filter((_, i) => i !== index);
};
</script>

<template>
  <div>
    <el-table :data="lines" size="small" empty-text="还没有物资">
      <el-table-column label="品名" min-width="140">
        <template #default="{ row }">{{ row.name }} {{ row.spec }}</template>
      </el-table-column>
      <el-table-column
        :label="props.docType === 'out' ? '在库' : '在场'"
        width="90"
        align="right"
      >
        <template #default="{ row }"
          >{{ row.available ?? "-" }} {{ row.unit }}</template
        >
      </el-table-column>
      <template v-if="props.docType === 'back'">
        <el-table-column label="退回" width="120">
          <template #default="{ row }"
            ><el-input v-model="row.returned" size="small"
          /></template>
        </el-table-column>
        <el-table-column label="丢失损坏" width="120">
          <template #default="{ row }"
            ><el-input
              v-model="row.lost"
              size="small"
              :disabled="row.kind === 'consumable'"
          /></template>
        </el-table-column>
      </template>
      <el-table-column v-else label="数量" width="130">
        <template #default="{ row }"
          ><el-input v-model="row.quantity" size="small"
        /></template>
      </el-table-column>
      <el-table-column width="60">
        <template #default="{ $index }"
          ><el-button link type="danger" @click="remove($index)"
            >移除</el-button
          ></template
        >
      </el-table-column>
    </el-table>
    <el-select
      v-if="props.allowAdd"
      v-model="picking"
      filterable
      remote
      :remote-method="search"
      :placeholder="
        props.docType === 'back' ? '另加没用完的耗材' : '搜索物资后添加'
      "
      style="width: 320px; margin-top: 8px"
      @focus="search('')"
      @change="add"
    >
      <el-option
        v-for="m in options"
        :key="m.id"
        :label="`${m.name} ${m.spec}（在库 ${m.quantity}${m.unit}）`"
        :value="m.id"
      />
    </el-select>
  </div>
</template>
