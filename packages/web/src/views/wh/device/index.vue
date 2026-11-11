<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { listDevices } from "@/api/wh/device";
import { listDeviceCategories } from "@/api/wh/settings";
import type { DeviceCategory, DeviceRow, DeviceState } from "@/api/wh/types";
import { DEVICE_STATE_LABELS, DEVICE_STATE_TAG } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import DeviceFormDialog from "./components/DeviceFormDialog.vue";
import DeviceImportDialog from "./components/DeviceImportDialog.vue";
import QrPrintDialog from "./components/QrPrintDialog.vue";

defineOptions({ name: "WhDevice" });

const route = useRoute();
const router = useRouter();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();

const STATES = Object.keys(DEVICE_STATE_LABELS) as DeviceState[];
const tab = ref<DeviceState | "all">(
  STATES.includes(route.query.state as DeviceState)
    ? (route.query.state as DeviceState)
    : "all"
);
const counts = ref<Record<string, number>>({});
const categories = ref<DeviceCategory[]>([]);
const filters = reactive<{ category_id?: number; keyword: string }>({
  keyword: ""
});
const page = reactive({ page: 1, pageSize: 20, total: 0 });
const rows = ref<DeviceRow[]>([]);
const selected = ref<DeviceRow[]>([]);
const formVisible = ref(false);
const importVisible = ref(false);
const qrVisible = ref(false);

const load = async () => {
  const result = await run(() =>
    listDevices({
      state: tab.value === "all" ? undefined : tab.value,
      category_id: filters.category_id,
      keyword: filters.keyword || undefined,
      page: page.page,
      pageSize: page.pageSize
    })
  );
  if (!result) return;
  rows.value = result.data;
  page.total = result.pagination.total;
};

const loadCounts = async () => {
  const totals = await Promise.all(
    (["all", ...STATES] as const).map(async state => {
      try {
        const result = await listDevices({
          state: state === "all" ? undefined : state,
          pageSize: 1
        });
        return [state, result.pagination.total] as const;
      } catch {
        return [state, 0] as const;
      }
    })
  );
  counts.value = Object.fromEntries(totals);
};

const reload = async () => {
  page.page = 1;
  await Promise.all([load(), loadCounts()]);
};

watch(tab, () => {
  void router.replace({
    query: tab.value === "all" ? {} : { state: tab.value }
  });
  page.page = 1;
  void load();
});

onMounted(async () => {
  const [categoryResult] = await Promise.all([
    run(() => listDeviceCategories()),
    loadCaps()
  ]);
  if (categoryResult) categories.value = categoryResult.data;
  await Promise.all([load(), loadCounts()]);
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <el-tabs v-model="tab">
      <el-tab-pane :label="`全部 ${counts.all ?? ''}`" name="all" />
      <el-tab-pane
        v-for="state in STATES"
        :key="state"
        :label="`${DEVICE_STATE_LABELS[state]} ${counts[state] ?? ''}`"
        :name="state"
      />
    </el-tabs>
    <div class="toolbar">
      <el-select
        v-model="filters.category_id"
        clearable
        placeholder="全部类别"
        style="width: 160px"
        @change="reload"
      >
        <el-option
          v-for="c in categories"
          :key="c.id"
          :label="c.name"
          :value="c.id"
        />
      </el-select>
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="编号、名称、现场叫法、型号"
        style="width: 240px"
        @change="reload"
      />
      <div class="spacer" />
      <template v-if="caps?.is_keeper">
        <el-button type="primary" @click="formVisible = true">新增</el-button>
        <el-button @click="importVisible = true">导入</el-button>
        <el-button :disabled="selected.length === 0" @click="qrVisible = true"
          >打印二维码（{{ selected.length }}）</el-button
        >
      </template>
    </div>
    <el-table
      :data="rows"
      row-key="id"
      empty-text="没有设备"
      @selection-change="value => (selected = value)"
    >
      <el-table-column v-if="caps?.is_keeper" type="selection" width="44" />
      <el-table-column prop="device_code" label="编号" width="120" />
      <el-table-column label="名称" min-width="200">
        <template #default="{ row }">
          <el-link
            type="primary"
            @click="router.push(`/wh/device/${row.id}`)"
            >{{ row.name }}</el-link
          >
        </template>
      </el-table-column>
      <el-table-column label="现场叫法" width="110">
        <template #default="{ row }">{{ row.alias ?? "-" }}</template>
      </el-table-column>
      <el-table-column prop="category_name" label="类别" width="100" />
      <el-table-column label="机型" width="100">
        <template #default="{ row }">{{ row.machine_type ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="口径" width="80">
        <template #default="{ row }">{{ row.diameter_mm ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag
            :type="DEVICE_STATE_TAG[row.state as DeviceState]"
            size="small"
            >{{ row.state_label }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column label="所在项目" min-width="150">
        <template #default="{ row }">{{ row.project_name ?? "-" }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page.page"
      v-model:page-size="page.pageSize"
      :total="page.total"
      :page-sizes="[20, 50, 100, 200]"
      layout="total, sizes, prev, pager, next"
      class="pager"
      @change="load"
    />
    <DeviceFormDialog
      v-model="formVisible"
      :device="null"
      :categories="categories"
      @saved="id => router.push(`/wh/device/${id}`)"
    />
    <DeviceImportDialog v-model="importVisible" @imported="reload" />
    <QrPrintDialog v-model="qrVisible" :devices="selected" />
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
