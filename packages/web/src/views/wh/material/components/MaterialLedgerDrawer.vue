<script setup lang="ts">
import { ref, watch } from "vue";

import { getMaterialLedger } from "@/api/wh/material";
import type { LedgerRow, Material } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../../shared/ids";
import { DOC_TYPE_LABELS } from "../../shared/labels";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ material: Material | null }>();
const visible = defineModel<boolean>({ required: true });
const { busy, run } = useWhAction();
const { loadUserNames, userNameOf } = useWecomUserOptions();
const rows = ref<LedgerRow[]>([]);
const page = ref({ page: 1, pageSize: 50, total: 0 });

const load = async () => {
  if (!props.material) return;
  const result = await run(() =>
    getMaterialLedger(props.material!.id, {
      page: page.value.page,
      pageSize: page.value.pageSize
    })
  );
  if (!result) return;
  rows.value = result.data;
  page.value.total = result.pagination.total;
};

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

watch(visible, open => {
  if (!open) return;
  page.value.page = 1;
  void loadUserNames();
  void load();
});
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="
      props.material
        ? `${props.material.name} ${props.material.spec} 流水`
        : '流水'
    "
    size="720px"
  >
    <el-table
      v-loading="busy"
      :data="rows"
      size="small"
      empty-text="还没有流水"
    >
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{
          formatTime(row.occurred_at)
        }}</template>
      </el-table-column>
      <el-table-column prop="doc_no" label="单号" width="160" />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">{{
          DOC_TYPE_LABELS[row.doc_type as keyof typeof DOC_TYPE_LABELS]
        }}</template>
      </el-table-column>
      <el-table-column label="项目" min-width="120">
        <template #default="{ row }">{{ row.project_name ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="在库变化" width="90" align="right">
        <template #default="{ row }">{{
          row.stock_delta === 0 ? "-" : signed(row.stock_delta)
        }}</template>
      </el-table-column>
      <el-table-column label="余额" width="80" align="right">
        <template #default="{ row }">{{ row.balance_after ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="90">
        <template #default="{ row }">{{
          userNameOf(row.operator_userid)
        }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page.page"
      :page-size="page.pageSize"
      :total="page.total"
      layout="total, prev, pager, next"
      style="margin-top: 12px"
      @current-change="load"
    />
  </el-drawer>
</template>
