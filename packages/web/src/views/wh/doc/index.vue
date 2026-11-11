<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";

import { listWhDocs } from "@/api/wh/doc";
import type { WhDocRow, WhDocType } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../shared/ids";
import { DOC_TYPE_LABELS } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import type { DocFormType } from "./doc-form-model";
import DocDetailDrawer from "./components/DocDetailDrawer.vue";
import DocFormDialog from "./components/DocFormDialog.vue";

defineOptions({ name: "WhDoc" });

const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const { loadUserNames, userNameOf } = useWecomUserOptions();
const TABS: (WhDocType | "all")[] = [
  "all",
  "inbound",
  "out",
  "back",
  "transfer",
  "opening",
  "adjust",
  "scrap"
];
const ACTIONS: DocFormType[] = ["inbound", "out", "back", "transfer"];
const tab = ref<WhDocType | "all">("all");
const filters = reactive<{ keyword: string; range: [string, string] | null }>({
  keyword: "",
  range: null
});
const page = reactive({ page: 1, pageSize: 20, total: 0 });
const rows = ref<WhDocRow[]>([]);
const formType = ref<DocFormType>("inbound");
const formVisible = ref(false);
const detailId = ref<number | null>(null);
const detailVisible = ref(false);

const load = async () => {
  const result = await run(() =>
    listWhDocs({
      doc_type: tab.value === "all" ? undefined : tab.value,
      keyword: filters.keyword || undefined,
      date_from: filters.range?.[0],
      date_to: filters.range?.[1],
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

const openForm = (type: DocFormType) => {
  formType.value = type;
  formVisible.value = true;
};

const openDetail = (row: WhDocRow) => {
  detailId.value = row.id;
  detailVisible.value = true;
};

watch(tab, reload);

onMounted(async () => {
  void loadUserNames();
  await Promise.all([loadCaps(), load()]);
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <el-tabs v-model="tab">
      <el-tab-pane
        v-for="t in TABS"
        :key="t"
        :label="t === 'all' ? '全部' : DOC_TYPE_LABELS[t]"
        :name="t"
      />
    </el-tabs>
    <div class="toolbar">
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="单号"
        style="width: 180px"
        @change="reload"
      />
      <el-date-picker
        v-model="filters.range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始"
        end-placeholder="结束"
        @change="reload"
      />
      <div class="spacer" />
      <template v-if="caps?.is_keeper">
        <el-button
          v-for="t in ACTIONS"
          :key="t"
          :type="t === 'out' ? 'primary' : 'default'"
          @click="openForm(t)"
          >{{ DOC_TYPE_LABELS[t] }}</el-button
        >
      </template>
    </div>
    <el-table :data="rows" empty-text="没有单据" @row-click="openDetail">
      <el-table-column prop="doc_no" label="单号" width="170" />
      <el-table-column label="类型" width="110">
        <template #default="{ row }"
          >{{ DOC_TYPE_LABELS[row.doc_type as WhDocType]
          }}{{ row.reverses_doc_id ? "（冲销）" : "" }}</template
        >
      </el-table-column>
      <el-table-column label="项目" min-width="180">
        <template #default="{ row }"
          >{{ row.project_name ?? "-"
          }}{{
            row.to_project_name ? ` → ${row.to_project_name}` : ""
          }}</template
        >
      </el-table-column>
      <el-table-column prop="line_count" label="行数" width="70" />
      <el-table-column label="领料人" width="100">
        <template #default="{ row }">{{ row.handover_name ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="100">
        <template #default="{ row }">{{
          userNameOf(row.operator_userid)
        }}</template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{
          formatTime(row.occurred_at)
        }}</template>
      </el-table-column>
      <el-table-column label="冲销" width="80">
        <template #default="{ row }">{{
          row.reversed_by_doc_no ? "已冲销" : ""
        }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page.page"
      v-model:page-size="page.pageSize"
      :total="page.total"
      layout="total, prev, pager, next"
      class="pager"
      @change="load"
    />
    <DocFormDialog
      :key="formType"
      v-model="formVisible"
      :doc-type="formType"
      @created="reload"
    />
    <DocDetailDrawer
      v-model="detailVisible"
      :doc-id="detailId"
      :can-reverse="Boolean(caps?.is_keeper)"
      @changed="reload"
    />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
