<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { listStocktakes, startStocktake } from "@/api/wh/stocktake";
import type {
  StocktakeRow,
  StocktakeScope,
  StocktakeStatus
} from "@/api/wh/stocktake-types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime } from "../shared/ids";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import {
  progressText,
  SCOPE_LABELS,
  STATUS_LABELS,
  STATUS_TAG
} from "./stocktake-view";

defineOptions({ name: "WhStocktake" });

const router = useRouter();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const { userNameOf, loadUserNames } = useWecomUserOptions();

const STATUSES = Object.keys(STATUS_LABELS) as StocktakeStatus[];
const SCOPES = Object.keys(SCOPE_LABELS) as StocktakeScope[];
const SCOPE_HINTS: Record<StocktakeScope, string> = {
  all: "物资逐条录实盘数，设备逐台标记",
  material: "只录物资的实盘数",
  device: "只核对在库的设备"
};

const query = reactive({
  status: "" as StocktakeStatus | "",
  page: 1,
  pageSize: 20
});
const rows = ref<StocktakeRow[]>([]);
const total = ref(0);
/** 进行中的那一次（最多一个）：有的话不能再发起 */
const counting = ref<StocktakeRow | null>(null);
const startOpen = ref(false);
const form = reactive({ scope: "all" as StocktakeScope, remark: "" });

const load = async () => {
  const [list, open] = await Promise.all([
    run(() =>
      listStocktakes({
        status: query.status || undefined,
        page: query.page,
        pageSize: query.pageSize
      })
    ),
    run(() => listStocktakes({ status: "counting", pageSize: 1 }))
  ]);
  if (list) {
    rows.value = list.data;
    total.value = list.pagination.total;
  }
  if (open) counting.value = open.data[0] ?? null;
};

watch(
  () => [query.status, query.pageSize],
  () => {
    query.page = 1;
    void load();
  }
);

const openStart = () => {
  Object.assign(form, { scope: "all", remark: "" });
  startOpen.value = true;
};

const submitStart = async () => {
  const result = await run(() =>
    startStocktake({
      scope: form.scope,
      remark: form.remark.trim() || undefined
    })
  );
  if (!result) {
    // 多半是别人刚发起了一次：刷新出「继续盘点」
    void load();
    return;
  }
  startOpen.value = false;
  void router.push(`/wh/stocktake/${result.data.id}`);
};

onMounted(async () => {
  void loadUserNames();
  await loadCaps();
  await load();
});
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="query.status">
      <el-tab-pane label="全部" name="" />
      <el-tab-pane
        v-for="status in STATUSES"
        :key="status"
        :label="STATUS_LABELS[status]"
        :name="status"
      />
    </el-tabs>
    <div class="toolbar">
      <span v-if="counting" class="hint"
        >{{ counting.stocktake_no }} 正在盘点，同一时间只能有一次。</span
      >
      <span class="spacer" />
      <el-button
        v-if="counting"
        type="primary"
        @click="router.push(`/wh/stocktake/${counting.id}`)"
        >{{ caps?.is_keeper ? "继续盘点" : "看这次盘点" }}</el-button
      >
      <el-button v-else-if="caps?.is_keeper" type="primary" @click="openStart"
        >发起盘点</el-button
      >
    </div>
    <el-table
      v-loading="busy"
      :data="rows"
      @row-click="(row: StocktakeRow) => router.push(`/wh/stocktake/${row.id}`)"
    >
      <el-table-column prop="stocktake_no" label="盘点单号" width="180" />
      <el-table-column label="范围" width="80">
        <template #default="{ row }">{{ SCOPE_LABELS[row.scope] }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="STATUS_TAG[row.status]">{{
            STATUS_LABELS[row.status]
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="物资已盘" width="110">
        <template #default="{ row }">{{
          progressText(row, "material")
        }}</template>
      </el-table-column>
      <el-table-column label="设备找到" width="110">
        <template #default="{ row }">{{
          progressText(row, "device")
        }}</template>
      </el-table-column>
      <el-table-column label="调整单" width="180">
        <template #default="{ row }">{{ row.adjust_doc_no ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="发起人" width="110">
        <template #default="{ row }">{{
          userNameOf(row.created_by_userid)
        }}</template>
      </el-table-column>
      <el-table-column label="发起时间" width="170">
        <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="{ row }">{{ row.remark ?? "" }}</template>
      </el-table-column>
      <template #empty>还没有盘点过</template>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="load"
      />
    </div>

    <el-dialog
      v-model="startOpen"
      title="发起盘点"
      width="460px"
      :close-on-click-modal="false"
    >
      <el-form label-width="60px" @submit.prevent>
        <el-form-item label="范围" required>
          <el-radio-group v-model="form.scope">
            <el-radio v-for="scope in SCOPES" :key="scope" :value="scope">{{
              SCOPE_LABELS[scope]
            }}</el-radio>
          </el-radio-group>
          <div class="form-hint">{{ SCOPE_HINTS[form.scope] }}</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            maxlength="200"
            placeholder="可不填，比如：年底盘点"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="startOpen = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submitStart"
          >开始盘点</el-button
        >
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.spacer {
  flex: 1;
}

.hint,
.form-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.form-hint {
  width: 100%;
  line-height: 1.6;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
