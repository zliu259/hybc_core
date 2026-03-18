<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  listAssetTypes,
  listTrackedAssets,
  type AssetType,
  type TrackedAsset
} from "@/api/asset";
import {
  addStocktakeLine,
  completeStocktakeTask,
  createStocktakeTask,
  getStocktakeTask,
  listInventory,
  listStocktakeTasks,
  listWarehouses,
  updateStocktakeLine,
  type InventoryRow,
  type StocktakeLine,
  type StocktakeTask,
  type Warehouse
} from "@/api/warehouse";
import { message } from "@/utils/message";

defineOptions({ name: "WarehouseStocktake" });

type StocktakeScope = "company" | "warehouse";
type StocktakeItemKind = "consumable" | "asset";
type StocktakeLineStatus = "normal" | "new" | "damaged" | "lost";

const loading = ref(false);
const creating = ref(false);
const taskDialogVisible = ref(false);

const newItemDialogVisible = ref(false);
const newItemSubmitting = ref(false);
const activeTaskLoading = ref(false);
const lineSavingId = ref<number | null>(null);

const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const inventoryRows = ref<InventoryRow[]>([]);
const trackedAssets = ref<TrackedAsset[]>([]);

const tasks = ref<StocktakeTask[]>([]);
const activeTask = ref<(StocktakeTask & { lines: StocktakeLine[] }) | null>(
  null
);

const createForm = ref({
  title: "",
  scope: "company" as StocktakeScope,
  warehouse_id: undefined as number | undefined,
  planned_date: ""
});

const newItemForm = ref({
  item_kind: "consumable" as StocktakeItemKind,
  warehouse_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined,
  custom_name: "",
  quantity: 1,
  unit: "件",
  line_status: "new" as StocktakeLineStatus,
  note: ""
});

const today = () => new Date().toISOString().slice(0, 10);

const toNum = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const lineStatusLabel: Record<StocktakeLineStatus, string> = {
  normal: "正常",
  new: "新增",
  damaged: "破损",
  lost: "盘亏"
};

const lineStatusTag: Record<
  StocktakeLineStatus,
  "success" | "warning" | "danger" | "info" | "primary"
> = {
  normal: "success",
  new: "primary",
  damaged: "warning",
  lost: "danger"
};

const isConsumableType = (typeId: number): boolean => {
  const item = assetTypes.value.find(row => row.id === typeId);
  return Boolean(item) && Number(item?.tracked_flag) === 0;
};

const consumableTypes = computed(() =>
  assetTypes.value.filter(item => Number(item.tracked_flag) === 0)
);
const trackedTypes = computed(() =>
  assetTypes.value.filter(item => Number(item.tracked_flag) === 1)
);

const companyOverview = computed(() => {
  const consumableRows = inventoryRows.value.filter(row =>
    isConsumableType(row.asset_type_id)
  );
  const companyInventoryQty = consumableRows.reduce(
    (sum, row) => sum + toNum(row.quantity),
    0
  );
  const completedCount = tasks.value.filter(
    item => item.status === "completed"
  ).length;
  const countingCount = tasks.value.filter(
    item => item.status === "counting"
  ).length;

  return {
    trackedAssetCount: trackedAssets.value.length,
    consumableTypeCount: new Set(consumableRows.map(item => item.asset_type_id))
      .size,
    companyInventoryQty,
    completedCount,
    countingCount
  };
});

const activeSummary = computed(() => {
  const task = activeTask.value;
  if (!task) {
    return { total: 0, counted: 0, pending: 0, diffCount: 0 };
  }
  const counted = task.lines.filter(item => item.counted_qty !== null).length;
  const diffCount = task.lines.filter(
    item => item.counted_qty !== null && item.diff_qty !== 0
  ).length;
  return {
    total: task.lines.length,
    counted,
    pending: task.lines.length - counted,
    diffCount
  };
});

const loadMeta = async () => {
  const [warehouseRes, typeRes, inventoryRes, trackedRes] = await Promise.all([
    listWarehouses(),
    listAssetTypes(),
    listInventory(),
    listTrackedAssets({ page: 1, pageSize: 1000 })
  ]);
  warehouses.value = warehouseRes.data;
  assetTypes.value = typeRes.data;
  inventoryRows.value = inventoryRes.data;
  trackedAssets.value = trackedRes.data;
};

const loadTasks = async () => {
  const result = await listStocktakeTasks();
  tasks.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    await Promise.all([loadMeta(), loadTasks()]);
  } finally {
    loading.value = false;
  }
};

const selectTask = async (taskId: number) => {
  activeTaskLoading.value = true;
  try {
    const detail = await getStocktakeTask(taskId);
    activeTask.value = detail.data;
  } finally {
    activeTaskLoading.value = false;
  }
};

const openCreateTask = () => {
  createForm.value = {
    title: "",
    scope: "company",
    warehouse_id: undefined,
    planned_date: today()
  };
  taskDialogVisible.value = true;
};

const createTask = async () => {
  const title = createForm.value.title.trim();
  if (!title) {
    message("请填写盘点任务名称", { type: "warning" });
    return;
  }
  if (!createForm.value.planned_date) {
    message("请选择盘点日期", { type: "warning" });
    return;
  }
  if (
    createForm.value.scope === "warehouse" &&
    !createForm.value.warehouse_id
  ) {
    message("仓库盘点模式需要选择仓库", { type: "warning" });
    return;
  }

  creating.value = true;
  try {
    const result = await createStocktakeTask({
      task_title: title,
      scope: createForm.value.scope,
      warehouse_id:
        createForm.value.scope === "warehouse"
          ? createForm.value.warehouse_id
          : undefined,
      planned_date: createForm.value.planned_date
    });
    taskDialogVisible.value = false;
    await loadTasks();
    await selectTask(result.data.id);
    message(`已创建盘点任务：${result.data.task_no}`, { type: "success" });
  } finally {
    creating.value = false;
  }
};

const saveLine = async (
  line: StocktakeLine,
  payload: Partial<Pick<StocktakeLine, "counted_qty" | "line_status" | "note">>
) => {
  if (!activeTask.value) return;
  lineSavingId.value = line.id;
  try {
    await updateStocktakeLine(activeTask.value.id, line.id, {
      counted_qty: payload.counted_qty,
      line_status: payload.line_status,
      note: payload.note
    });
    await selectTask(activeTask.value.id);
  } finally {
    lineSavingId.value = null;
  }
};

const fillExpectedQty = async () => {
  if (!activeTask.value) return;
  for (const line of activeTask.value.lines) {
    await saveLine(line, { counted_qty: line.expected_qty });
  }
  message("已批量带入账面数量", { type: "success" });
};

const markTaskCompleted = async () => {
  if (!activeTask.value) return;
  const hasPending = activeTask.value.lines.some(
    item => item.counted_qty === null
  );
  if (hasPending) {
    message("仍有未录入的盘点项，请先完成数量录入", { type: "warning" });
    return;
  }
  const result = await completeStocktakeTask(activeTask.value.id);
  await loadTasks();
  await selectTask(activeTask.value.id);
  message(`盘点任务已完成，差异条目 ${result.data.diff_count} 条`, {
    type: "success"
  });
};

const statusTag = (status: StocktakeTask["status"]) => {
  if (status === "completed") return "success";
  if (status === "counting") return "warning";
  return "info";
};

const statusLabel = (status: StocktakeTask["status"]) => {
  if (status === "completed") return "已完成";
  if (status === "counting") return "盘点中";
  return "草稿";
};

const kindLabel = (kind: StocktakeItemKind) =>
  kind === "asset" ? "设备资产" : "消耗品";

const openNewItemDialog = () => {
  if (!activeTask.value) {
    message("请先创建并选择一个盘点任务", { type: "warning" });
    return;
  }

  const defaultWarehouseId =
    activeTask.value.scope === "warehouse"
      ? activeTask.value.warehouse_id || undefined
      : undefined;

  newItemForm.value = {
    item_kind: "consumable",
    warehouse_id: defaultWarehouseId,
    asset_type_id: undefined,
    custom_name: "",
    quantity: 1,
    unit: "件",
    line_status: "new",
    note: ""
  };
  newItemDialogVisible.value = true;
};

const submitNewItem = async () => {
  if (!activeTask.value) {
    message("请先选择盘点任务", { type: "warning" });
    return;
  }
  if (!newItemForm.value.warehouse_id) {
    message("请选择归属仓库", { type: "warning" });
    return;
  }
  if (toNum(newItemForm.value.quantity) <= 0) {
    message("数量必须大于 0", { type: "warning" });
    return;
  }

  const customName = newItemForm.value.custom_name.trim();
  if (!newItemForm.value.asset_type_id && !customName) {
    message("请选择资产类型或填写新物品名称", { type: "warning" });
    return;
  }

  newItemSubmitting.value = true;
  try {
    await addStocktakeLine(activeTask.value.id, {
      warehouse_id: newItemForm.value.warehouse_id,
      item_kind: newItemForm.value.item_kind,
      asset_type_id: newItemForm.value.asset_type_id,
      item_name: customName || undefined,
      unit: newItemForm.value.unit,
      counted_qty: Number(newItemForm.value.quantity),
      line_status: newItemForm.value.line_status,
      note: newItemForm.value.note || undefined
    });
    newItemDialogVisible.value = false;
    await selectTask(activeTask.value.id);
    message("已加入盘点新增物品并完成数量录入", { type: "success" });
  } finally {
    newItemSubmitting.value = false;
  }
};

onMounted(async () => {
  await loadData();
  if (tasks.value.length > 0) {
    await selectTask(tasks.value[0].id);
  }
});
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="stocktake">
    <template #header>
      <div class="head">
        <div>
          <div class="title">公司资产盘库</div>
          <div class="sub">
            盘库中可直接新增发现的设备/消耗品并填写数量与状态，无需跳转其他页面
          </div>
        </div>
        <div class="actions">
          <el-button @click="loadData">刷新基线库存</el-button>
          <el-button @click="openNewItemDialog">盘库新增物品</el-button>
          <el-button type="primary" @click="openCreateTask"
            >新建盘点任务</el-button
          >
        </div>
      </div>
    </template>

    <el-row :gutter="10" class="kpi-row">
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">设备总量（有状态）</div>
          <div class="kpi-value">{{ companyOverview.trackedAssetCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">消耗品类型数</div>
          <div class="kpi-value">{{ companyOverview.consumableTypeCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">消耗品库存总量</div>
          <div class="kpi-value">{{ companyOverview.companyInventoryQty }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card kpi-card--ok">
          <div class="kpi-label">盘点任务（进行中/已完成）</div>
          <div class="kpi-value">
            {{ companyOverview.countingCount }} /
            {{ companyOverview.completedCount }}
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="12">
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="panel-title">盘点任务列表</div>
          </template>
          <div class="task-list">
            <div
              v-for="item in tasks"
              :key="item.id"
              class="task-item"
              :class="{ 'task-item--active': activeTask?.id === item.id }"
              @click="selectTask(item.id)"
            >
              <div class="task-item__top">
                <div class="task-item__title">{{ item.task_title }}</div>
                <el-tag size="small" :type="statusTag(item.status)">{{
                  statusLabel(item.status)
                }}</el-tag>
              </div>
              <div class="task-item__meta">单号：{{ item.task_no }}</div>
              <div class="task-item__meta">
                范围：{{ item.warehouse_name || "全公司" }} · 日期：{{
                  item.planned_date
                }}
              </div>
            </div>
            <el-empty
              v-if="!tasks.length"
              description="暂无盘点任务"
              :image-size="90"
            />
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="16">
        <el-card v-loading="activeTaskLoading" shadow="never" class="panel">
          <template #header>
            <div class="active-head">
              <div>
                <div class="panel-title">盘点执行区</div>
                <div v-if="activeTask" class="active-sub">
                  {{ activeTask.task_no }} · {{ activeTask.task_title }}
                </div>
              </div>
              <div v-if="activeTask" class="actions">
                <el-button @click="openNewItemDialog">新增发现物品</el-button>
                <el-button @click="fillExpectedQty">一键带入账面数量</el-button>
                <el-button type="primary" @click="markTaskCompleted"
                  >完成盘点</el-button
                >
              </div>
            </div>
          </template>

          <template v-if="activeTask">
            <el-row :gutter="10" class="summary-row">
              <el-col :sm="6" :xs="12">
                <div class="summary-card">
                  总条目：{{ activeSummary.total }}
                </div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card">
                  已录入：{{ activeSummary.counted }}
                </div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card">
                  待录入：{{ activeSummary.pending }}
                </div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card summary-card--warn">
                  差异条目：{{ activeSummary.diffCount }}
                </div>
              </el-col>
            </el-row>

            <el-table
              :data="activeTask.lines"
              size="small"
              style="margin-top: 8px"
            >
              <el-table-column label="类别" width="90">
                <template #default="scope">
                  {{ kindLabel(scope.row.item_kind) }}
                </template>
              </el-table-column>
              <el-table-column
                prop="warehouse_name"
                label="仓库"
                min-width="110"
              />
              <el-table-column
                prop="item_name"
                label="物品/类型"
                min-width="160"
              />
              <el-table-column
                prop="expected_qty"
                label="账面数量"
                width="110"
              />
              <el-table-column label="实盘数量" width="160">
                <template #default="scope">
                  <el-input-number
                    :model-value="scope.row.counted_qty"
                    :min="0"
                    :precision="2"
                    :step="1"
                    :disabled="lineSavingId === scope.row.id"
                    @update:model-value="
                      saveLine(scope.row, { counted_qty: $event })
                    "
                  />
                </template>
              </el-table-column>
              <el-table-column label="状态" width="120">
                <template #default="scope">
                  <el-select
                    v-model="scope.row.line_status"
                    size="small"
                    style="width: 100%"
                    :disabled="lineSavingId === scope.row.id"
                    @change="saveLine(scope.row, { line_status: $event })"
                  >
                    <el-option label="正常" value="normal" />
                    <el-option label="新增" value="new" />
                    <el-option label="破损" value="damaged" />
                    <el-option label="盘亏" value="lost" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="差异" width="100">
                <template #default="scope">
                  <span :class="{ 'diff-warn': scope.row.diff_qty !== 0 }">
                    {{ scope.row.diff_qty }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="170">
                <template #default="scope">
                  <el-input
                    :model-value="scope.row.note"
                    placeholder="记录原因/处理意见"
                    @change="saveLine(scope.row, { note: $event })"
                  />
                </template>
              </el-table-column>
            </el-table>
          </template>

          <el-empty
            v-else
            description="请选择或新建盘点任务"
            :image-size="100"
          />
        </el-card>
      </el-col>
    </el-row>
  </el-card>

  <el-dialog v-model="taskDialogVisible" title="新建盘点任务" width="560px">
    <el-form label-width="100px">
      <el-form-item label="任务名称" required>
        <el-input
          v-model="createForm.title"
          placeholder="例如：2026Q1 全公司盘点"
        />
      </el-form-item>
      <el-form-item label="盘点范围" required>
        <el-radio-group v-model="createForm.scope">
          <el-radio label="company">全公司</el-radio>
          <el-radio label="warehouse">单仓库</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item
        v-if="createForm.scope === 'warehouse'"
        label="指定仓库"
        required
      >
        <el-select
          v-model="createForm.warehouse_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="盘点日期" required>
        <el-date-picker
          v-model="createForm.planned_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="taskDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="createTask"
        >创建任务</el-button
      >
    </template>
  </el-dialog>

  <el-dialog v-model="newItemDialogVisible" title="盘库新增物品" width="620px">
    <el-form label-width="120px">
      <el-form-item label="物品类别" required>
        <el-radio-group v-model="newItemForm.item_kind">
          <el-radio label="consumable">消耗品</el-radio>
          <el-radio label="asset">设备资产</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="归属仓库" required>
        <el-select
          v-model="newItemForm.warehouse_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="资产类型（可选）">
        <el-select
          v-model="newItemForm.asset_type_id"
          clearable
          filterable
          style="width: 100%"
          :placeholder="
            newItemForm.item_kind === 'asset'
              ? '优先选择有状态资产类型'
              : '优先选择消耗品类型'
          "
        >
          <el-option
            v-for="item in newItemForm.item_kind === 'asset'
              ? trackedTypes
              : consumableTypes"
            :key="item.id"
            :label="`${item.type_name} (${item.type_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="新物品名称">
        <el-input
          v-model="newItemForm.custom_name"
          placeholder="未建类型时，可直接录入物品名称"
        />
      </el-form-item>
      <el-form-item label="盘点数量" required>
        <el-input-number
          v-model="newItemForm.quantity"
          :min="0.01"
          :precision="2"
        />
      </el-form-item>
      <el-form-item label="单位">
        <el-input v-model="newItemForm.unit" style="width: 160px" />
      </el-form-item>
      <el-form-item label="状态" required>
        <el-select v-model="newItemForm.line_status" style="width: 160px">
          <el-option label="正常" value="normal" />
          <el-option label="新增" value="new" />
          <el-option label="破损" value="damaged" />
          <el-option label="盘亏" value="lost" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="newItemForm.note" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item>
        <el-tag :type="lineStatusTag[newItemForm.line_status]">
          状态说明：{{ lineStatusLabel[newItemForm.line_status] }}
        </el-tag>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="newItemDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="newItemSubmitting"
        @click="submitNewItem"
        >加入当前盘点</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.stocktake {
  background: #fffaf2;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.kpi-row {
  margin-bottom: 12px;
}

.kpi-card {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.kpi-card--ok {
  border-color: #b9e2c0;
}

.kpi-label {
  color: #6e6458;
  font-size: 13px;
}

.kpi-value {
  margin-top: 6px;
  color: #2a241d;
  font-size: 24px;
  font-weight: 700;
}

.panel {
  border: 1px solid #e8ddc8;
  min-height: 540px;
}

.panel-title {
  font-weight: 600;
  color: #2a241d;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  border: 1px solid #d9ceb9;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  background: #fff;
}

.task-item--active {
  border-color: #2f6c5f;
  box-shadow: 0 0 0 1px #2f6c5f;
}

.task-item__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.task-item__title {
  font-weight: 600;
  color: #2a241d;
}

.task-item__meta {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.active-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.active-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.summary-row {
  margin-bottom: 8px;
}

.summary-card {
  border: 1px solid #d9ceb9;
  border-radius: 8px;
  background: #fff;
  color: #2a241d;
  padding: 8px;
  font-size: 13px;
}

.summary-card--warn {
  border-color: #f3d19e;
}

.diff-warn {
  color: #bd3f3f;
  font-weight: 700;
}

@media (max-width: 900px) {
  .head,
  .active-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
