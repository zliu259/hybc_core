<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";

import { listMaterials } from "@/api/wh/material";
import type { Material, MaterialKind } from "@/api/wh/types";
import { MATERIAL_CATEGORIES, MATERIAL_KIND_LABELS } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import MaterialFormDialog from "./components/MaterialFormDialog.vue";
import MaterialImportDialog from "./components/MaterialImportDialog.vue";
import MaterialLedgerDrawer from "./components/MaterialLedgerDrawer.vue";

defineOptions({ name: "WhMaterial" });

const route = useRoute();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const filters = reactive<{
  keyword: string;
  category?: string;
  kind?: MaterialKind;
  lowOnly: boolean;
}>({
  keyword: "",
  lowOnly: route.query.low_stock === "1"
});
const page = reactive({ page: 1, pageSize: 50, total: 0 });
const rows = ref<Material[]>([]);
const editing = ref<Material | null>(null);
const formVisible = ref(false);
const importVisible = ref(false);
const ledgerVisible = ref(false);

const isLow = (m: Material) =>
  m.min_stock !== null && m.quantity <= m.min_stock;

const load = async () => {
  const result = await run(() =>
    listMaterials({
      keyword: filters.keyword || undefined,
      category: filters.category,
      kind: filters.kind,
      low_stock: filters.lowOnly ? "1" : undefined,
      page: page.page,
      pageSize: page.pageSize
    })
  );
  if (!result) return;
  rows.value = result.data;
  page.total = result.pagination.total;
};

const reload = () => {
  page.page = 1;
  void load();
};

const openForm = (material: Material | null) => {
  editing.value = material;
  formVisible.value = true;
};

const openLedger = (material: Material) => {
  editing.value = material;
  ledgerVisible.value = true;
};

onMounted(async () => {
  await Promise.all([loadCaps(), load()]);
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <div class="toolbar">
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="编号、品名、规格"
        style="width: 200px"
        @change="reload"
      />
      <el-select
        v-model="filters.category"
        clearable
        placeholder="全部分节"
        style="width: 150px"
        @change="reload"
      >
        <el-option
          v-for="c in MATERIAL_CATEGORIES"
          :key="c"
          :label="c"
          :value="c"
        />
      </el-select>
      <el-select
        v-model="filters.kind"
        clearable
        placeholder="全部管法"
        style="width: 120px"
        @change="reload"
      >
        <el-option label="周转" value="turnover" />
        <el-option label="消耗" value="consumable" />
      </el-select>
      <el-checkbox v-model="filters.lowOnly" @change="reload"
        >只看低库存</el-checkbox
      >
      <div class="spacer" />
      <template v-if="caps?.is_keeper">
        <el-button type="primary" @click="openForm(null)">新增</el-button>
        <el-button @click="importVisible = true">导入</el-button>
      </template>
    </div>
    <el-table :data="rows" empty-text="没有物资" @row-dblclick="openLedger">
      <el-table-column prop="material_code" label="编号" width="100" />
      <el-table-column prop="name" label="品名" min-width="140" />
      <el-table-column prop="spec" label="规格" min-width="120" />
      <el-table-column prop="unit" label="单位" width="70" />
      <el-table-column prop="category" label="分节" width="120" />
      <el-table-column label="管法" width="70">
        <template #default="{ row }">{{
          MATERIAL_KIND_LABELS[row.kind as MaterialKind]
        }}</template>
      </el-table-column>
      <el-table-column label="在库" width="90" align="right">
        <template #default="{ row }">
          <span :class="{ low: isLow(row) }">{{ row.quantity }}</span>
        </template>
      </el-table-column>
      <el-table-column label="最低库存" width="90" align="right">
        <template #default="{ row }">{{ row.min_stock ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="库位" width="100">
        <template #default="{ row }">{{ row.storage_note ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openLedger(row)"
            >流水</el-button
          >
          <el-button v-if="caps?.is_keeper" link @click="openForm(row)"
            >修改</el-button
          >
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page.page"
      v-model:page-size="page.pageSize"
      :total="page.total"
      :page-sizes="[50, 100, 200, 500]"
      layout="total, sizes, prev, pager, next"
      class="pager"
      @change="load"
    />
    <MaterialFormDialog
      v-model="formVisible"
      :material="editing"
      @saved="load"
    />
    <MaterialImportDialog v-model="importVisible" @imported="reload" />
    <MaterialLedgerDrawer v-model="ledgerVisible" :material="editing" />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.low {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
