<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listAssetTypes, listTrackedAssets, type AssetType, type TrackedAsset } from "@/api/asset";
import { listInventory, listWarehouses, type InventoryRow, type Warehouse } from "@/api/warehouse";
import { message } from "@/utils/message";

defineOptions({ name: "WarehouseStocktake" });

type StocktakeScope = "company" | "warehouse";

type StocktakeLine = {
  id: string;
  warehouse_id: number;
  warehouse_name: string;
  asset_type_id: number;
  type_name: string;
  unit: string;
  expected_qty: number;
  counted_qty: number | null;
  diff_qty: number;
  note: string;
};

type StocktakeTask = {
  id: string;
  title: string;
  scope: StocktakeScope;
  warehouse_id: number | null;
  warehouse_name: string;
  planned_date: string;
  created_at: string;
  status: "draft" | "counting" | "completed";
  lines: StocktakeLine[];
};

const loading = ref(false);
const creating = ref(false);
const taskDialogVisible = ref(false);

const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const inventoryRows = ref<InventoryRow[]>([]);
const trackedAssets = ref<TrackedAsset[]>([]);

const tasks = ref<StocktakeTask[]>([]);
const activeTaskId = ref<string>("");

const createForm = ref({
  title: "",
  scope: "company" as StocktakeScope,
  warehouse_id: undefined as number | undefined,
  planned_date: ""
});

const today = () => new Date().toISOString().slice(0, 10);

const toNum = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isConsumableType = (typeId: number): boolean => {
  const item = assetTypes.value.find(row => row.id === typeId);
  return Boolean(item) && Number(item?.tracked_flag) === 0;
};

const companyOverview = computed(() => {
  const consumableRows = inventoryRows.value.filter(row => isConsumableType(row.asset_type_id));
  const companyInventoryQty = consumableRows.reduce((sum, row) => sum + toNum(row.quantity), 0);
  const completedCount = tasks.value.filter(item => item.status === "completed").length;
  const countingCount = tasks.value.filter(item => item.status === "counting").length;

  return {
    trackedAssetCount: trackedAssets.value.length,
    consumableTypeCount: new Set(consumableRows.map(item => item.asset_type_id)).size,
    companyInventoryQty,
    completedCount,
    countingCount
  };
});

const activeTask = computed(() => tasks.value.find(item => item.id === activeTaskId.value) || null);

const activeSummary = computed(() => {
  const task = activeTask.value;
  if (!task) {
    return { total: 0, counted: 0, pending: 0, diffCount: 0 };
  }
  const counted = task.lines.filter(item => item.counted_qty !== null).length;
  const diffCount = task.lines.filter(item => item.counted_qty !== null && item.diff_qty !== 0).length;
  return {
    total: task.lines.length,
    counted,
    pending: task.lines.length - counted,
    diffCount
  };
});

const loadData = async () => {
  loading.value = true;
  try {
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
  } finally {
    loading.value = false;
  }
};

const buildStocktakeLines = (scope: StocktakeScope, warehouseId?: number): StocktakeLine[] => {
  const rows = inventoryRows.value.filter(item => {
    if (!isConsumableType(item.asset_type_id)) return false;
    if (scope === "warehouse" && warehouseId && item.warehouse_id !== warehouseId) return false;
    return true;
  });

  return rows.map(item => ({
    id: `${item.warehouse_id}-${item.asset_type_id}`,
    warehouse_id: item.warehouse_id,
    warehouse_name: item.warehouse_name || `仓库#${item.warehouse_id}`,
    asset_type_id: item.asset_type_id,
    type_name: item.type_name || `资产类型#${item.asset_type_id}`,
    unit: item.unit || "件",
    expected_qty: toNum(item.quantity),
    counted_qty: null,
    diff_qty: 0,
    note: ""
  }));
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
  if (createForm.value.scope === "warehouse" && !createForm.value.warehouse_id) {
    message("仓库盘点模式需要选择仓库", { type: "warning" });
    return;
  }

  creating.value = true;
  try {
    const lines = buildStocktakeLines(createForm.value.scope, createForm.value.warehouse_id);
    if (!lines.length) {
      message("当前范围内没有可盘点的消耗品库存", { type: "warning" });
      return;
    }
    const warehouseName =
      createForm.value.scope === "company"
        ? "全公司"
        : warehouses.value.find(item => item.id === createForm.value.warehouse_id)?.warehouse_name || "指定仓库";

    const task: StocktakeTask = {
      id: `st-${Date.now()}`,
      title,
      scope: createForm.value.scope,
      warehouse_id: createForm.value.scope === "warehouse" ? createForm.value.warehouse_id || null : null,
      warehouse_name: warehouseName,
      planned_date: createForm.value.planned_date,
      created_at: new Date().toISOString(),
      status: "counting",
      lines
    };

    tasks.value.unshift(task);
    activeTaskId.value = task.id;
    taskDialogVisible.value = false;
    message(`已创建盘点任务：${title}`, { type: "success" });
  } finally {
    creating.value = false;
  }
};

const updateCountedQty = (line: StocktakeLine, value: number | null) => {
  line.counted_qty = value;
  line.diff_qty = value === null ? 0 : Number((value - line.expected_qty).toFixed(2));
};

const fillExpectedQty = () => {
  if (!activeTask.value) return;
  activeTask.value.lines.forEach(item => {
    updateCountedQty(item, item.expected_qty);
  });
};

const markTaskCompleted = () => {
  const task = activeTask.value;
  if (!task) return;
  const hasPending = task.lines.some(item => item.counted_qty === null);
  if (hasPending) {
    message("仍有未录入的盘点项，请先完成数量录入", { type: "warning" });
    return;
  }
  task.status = "completed";
  message("盘点任务已完成，可导出差异结果", { type: "success" });
};

const statusTag = (status: StocktakeTask["status"]) => {
  if (status === "completed") return "success";
  if (status === "counting") return "warning";
  return "info";
};

onMounted(async () => {
  await loadData();
  openCreateTask();
});
</script>

<template>
  <el-card shadow="never" class="stocktake" v-loading="loading">
    <template #header>
      <div class="head">
        <div>
          <div class="title">公司资产盘库</div>
          <div class="sub">按周期创建盘点任务，录入实盘数量并实时得到差异结果</div>
        </div>
        <div class="actions">
          <el-button @click="loadData">刷新基线库存</el-button>
          <el-button type="primary" @click="openCreateTask">新建盘点任务</el-button>
        </div>
      </div>
    </template>

    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="当前盘库页为前端交互版：用于周期盘点组织与差异记录，后续可直接对接正式盘库 API。"
      style="margin-bottom: 12px"
    />

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
            {{ companyOverview.countingCount }} / {{ companyOverview.completedCount }}
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
              :class="{ 'task-item--active': activeTaskId === item.id }"
              @click="activeTaskId = item.id"
            >
              <div class="task-item__top">
                <div class="task-item__title">{{ item.title }}</div>
                <el-tag size="small" :type="statusTag(item.status)">{{ item.status }}</el-tag>
              </div>
              <div class="task-item__meta">范围：{{ item.warehouse_name }} · 日期：{{ item.planned_date }}</div>
              <div class="task-item__meta">盘点条目：{{ item.lines.length }}</div>
            </div>
            <el-empty v-if="!tasks.length" description="暂无盘点任务" :image-size="90" />
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="16">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="active-head">
              <div>
                <div class="panel-title">盘点执行区</div>
                <div v-if="activeTask" class="active-sub">
                  {{ activeTask.title }} · {{ activeTask.warehouse_name }}
                </div>
              </div>
              <div v-if="activeTask" class="actions">
                <el-button @click="fillExpectedQty">一键带入账面数量</el-button>
                <el-button type="primary" @click="markTaskCompleted">完成盘点</el-button>
              </div>
            </div>
          </template>

          <template v-if="activeTask">
            <el-row :gutter="10" class="summary-row">
              <el-col :sm="6" :xs="12">
                <div class="summary-card">总条目：{{ activeSummary.total }}</div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card">已录入：{{ activeSummary.counted }}</div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card">待录入：{{ activeSummary.pending }}</div>
              </el-col>
              <el-col :sm="6" :xs="12">
                <div class="summary-card summary-card--warn">差异条目：{{ activeSummary.diffCount }}</div>
              </el-col>
            </el-row>

            <el-table :data="activeTask.lines" size="small" style="margin-top: 8px">
              <el-table-column prop="warehouse_name" label="仓库" min-width="110" />
              <el-table-column prop="type_name" label="消耗品类型" min-width="160" />
              <el-table-column prop="expected_qty" label="账面数量" width="110" />
              <el-table-column label="实盘数量" width="150">
                <template #default="scope">
                  <el-input-number
                    :model-value="scope.row.counted_qty"
                    :min="0"
                    :precision="2"
                    :step="1"
                    @update:model-value="updateCountedQty(scope.row, $event)"
                  />
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
                  <el-input v-model="scope.row.note" placeholder="记录原因/处理意见" />
                </template>
              </el-table-column>
            </el-table>
          </template>

          <el-empty v-else description="请选择或新建盘点任务" :image-size="100" />
        </el-card>
      </el-col>
    </el-row>
  </el-card>

  <el-dialog v-model="taskDialogVisible" title="新建盘点任务" width="560px">
    <el-form label-width="100px">
      <el-form-item label="任务名称" required>
        <el-input v-model="createForm.title" placeholder="例如：2026Q1 全公司盘点" />
      </el-form-item>
      <el-form-item label="盘点范围" required>
        <el-radio-group v-model="createForm.scope">
          <el-radio label="company">全公司</el-radio>
          <el-radio label="warehouse">单仓库</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="createForm.scope === 'warehouse'" label="指定仓库" required>
        <el-select v-model="createForm.warehouse_id" filterable style="width: 100%">
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
      <el-button type="primary" :loading="creating" @click="createTask">创建任务</el-button>
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
