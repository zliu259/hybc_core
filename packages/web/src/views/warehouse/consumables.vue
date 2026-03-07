<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listAssetTypes, type AssetType } from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  createConsumption,
  listConsumptions,
  listInventory,
  listWarehouses,
  type InventoryRow,
  type Warehouse
} from "@/api/warehouse";
import { message } from "@/utils/message";

defineOptions({ name: "WarehouseConsumables" });

type ConsumptionRecord = Record<string, unknown>;

const router = useRouter();
const loading = ref(false);
const submitting = ref(false);

const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const projects = ref<Project[]>([]);

const inventoryRows = ref<InventoryRow[]>([]);
const consumptionRows = ref<ConsumptionRecord[]>([]);

const filters = ref({
  warehouse_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined,
  project_id: undefined as number | undefined
});

const consumptionDialogVisible = ref(false);
const form = ref({
  warehouse_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined,
  quantity: 1,
  consumed_date: "",
  remark: ""
});

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
};

const formatDateOnly = (value: unknown): string => {
  const text = toString(value);
  if (!text) return "-";
  return text.slice(0, 10);
};

const formatQty = (value: unknown): string => {
  const qty = toNumber(value);
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
};

const consumableTypes = computed(() =>
  assetTypes.value.filter(item => Number(item.tracked_flag) === 0)
);

const consumableTypeMap = computed(() => {
  const map: Record<number, AssetType> = {};
  consumableTypes.value.forEach(item => {
    map[item.id] = item;
  });
  return map;
});

const filteredInventoryRows = computed(() =>
  inventoryRows.value.filter(row => {
    const isConsumable = Boolean(consumableTypeMap.value[row.asset_type_id]);
    if (!isConsumable) return false;
    if (filters.value.asset_type_id && row.asset_type_id !== filters.value.asset_type_id) {
      return false;
    }
    return true;
  })
);

const kpis = computed(() => {
  const totalQty = filteredInventoryRows.value.reduce(
    (sum, row) => sum + toNumber(row.quantity),
    0
  );
  const recent30Days = consumptionRows.value.filter(item => {
    const dateText = toString(item.consumed_date || item.created_at);
    if (!dateText) return false;
    const ts = Date.parse(dateText);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts <= 30 * 24 * 60 * 60 * 1000;
  }).length;

  return {
    typeCount: consumableTypes.value.length,
    inventoryCount: filteredInventoryRows.value.length,
    totalQty,
    recent30Days
  };
});

const resetForm = () => {
  form.value = {
    warehouse_id: filters.value.warehouse_id,
    project_id: filters.value.project_id,
    asset_type_id: filters.value.asset_type_id,
    quantity: 1,
    consumed_date: new Date().toISOString().slice(0, 10),
    remark: ""
  };
};

const loadMeta = async () => {
  const [warehouseRes, typeRes, projectRes] = await Promise.all([
    listWarehouses(),
    listAssetTypes(),
    listProjects({ page: 1, pageSize: 500 })
  ]);
  warehouses.value = warehouseRes.data;
  assetTypes.value = typeRes.data;
  projects.value = projectRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [inventoryRes, consumptionsRes] = await Promise.all([
      listInventory({
        warehouse_id: filters.value.warehouse_id,
        asset_type_id: filters.value.asset_type_id
      }),
      listConsumptions({ project_id: filters.value.project_id })
    ]);
    inventoryRows.value = inventoryRes.data;
    consumptionRows.value = consumptionsRes.data;
  } finally {
    loading.value = false;
  }
};

const openCreateConsumption = () => {
  resetForm();
  consumptionDialogVisible.value = true;
};

const submitConsumption = async () => {
  if (!form.value.warehouse_id || !form.value.asset_type_id || !form.value.consumed_date) {
    message("请完整填写仓库、消耗品类型、消耗日期", { type: "warning" });
    return;
  }
  if (!consumableTypeMap.value[form.value.asset_type_id]) {
    message("请选择消耗品类型（无状态资产）", { type: "warning" });
    return;
  }
  if (toNumber(form.value.quantity) <= 0) {
    message("消耗数量必须大于 0", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    await createConsumption({
      warehouse_id: form.value.warehouse_id,
      project_id: form.value.project_id,
      asset_type_id: form.value.asset_type_id,
      quantity: form.value.quantity,
      consumed_date: form.value.consumed_date,
      remark: form.value.remark || undefined
    });
    message("消耗品消耗登记成功", { type: "success" });
    consumptionDialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const goCreator = () => {
  router.push("/warehouse-assets/creator");
};

const goStocktake = () => {
  router.push("/warehouse-assets/stocktake");
};

onMounted(async () => {
  await loadMeta();
  resetForm();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" class="consumables" v-loading="loading">
    <template #header>
      <div class="head">
        <div>
          <div class="title">消耗品管理总览</div>
          <div class="sub">独立查看耗材库存与消耗记录，并串联出入库制单入口</div>
        </div>
        <div class="actions">
          <el-button @click="goCreator">去出入库制单</el-button>
          <el-button @click="goStocktake">去公司盘库</el-button>
          <el-button type="primary" @click="openCreateConsumption">登记消耗</el-button>
        </div>
      </div>
    </template>

    <el-row :gutter="10" class="kpi-row">
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">消耗品类型数</div>
          <div class="kpi-value">{{ kpis.typeCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">库存条目</div>
          <div class="kpi-value">{{ kpis.inventoryCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">当前库存总量</div>
          <div class="kpi-value">{{ formatQty(kpis.totalQty) }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card kpi-card--ok">
          <div class="kpi-label">近 30 天消耗记录</div>
          <div class="kpi-value">{{ kpis.recent30Days }}</div>
        </div>
      </el-col>
    </el-row>

    <el-form inline>
      <el-form-item label="仓库">
        <el-select v-model="filters.warehouse_id" clearable filterable style="width: 180px">
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="消耗品类型">
        <el-select v-model="filters.asset_type_id" clearable filterable style="width: 220px">
          <el-option
            v-for="item in consumableTypes"
            :key="item.id"
            :label="`${item.type_name} (${item.type_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联项目">
        <el-select v-model="filters.project_id" clearable filterable style="width: 220px">
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-card shadow="never" class="panel" style="margin-top: 12px">
      <template #header>
        <div class="panel-title">消耗品库存清单</div>
      </template>
      <el-table :data="filteredInventoryRows" empty-text="暂无消耗品库存数据">
        <el-table-column prop="warehouse_name" label="仓库" min-width="120" />
        <el-table-column prop="type_name" label="消耗品类型" min-width="160" />
        <el-table-column prop="quantity" label="库存数量" width="120" />
        <el-table-column prop="unit" label="单位" width="90" />
        <el-table-column prop="min_stock" label="最小库存" width="110" />
        <el-table-column prop="updated_at" label="更新时间" width="190" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="panel" style="margin-top: 12px">
      <template #header>
        <div class="panel-title">消耗登记记录</div>
      </template>
      <el-table :data="consumptionRows" size="small" empty-text="暂无消耗记录">
        <el-table-column label="消耗日期" width="120">
          <template #default="scope">
            {{ formatDateOnly(scope.row.consumed_date) }}
          </template>
        </el-table-column>
        <el-table-column label="仓库" min-width="140">
          <template #default="scope">
            {{ toString(scope.row.warehouse_name) || toString(scope.row.warehouse_id) || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="消耗品类型" min-width="180">
          <template #default="scope">
            {{ toString(scope.row.type_name) || toString(scope.row.asset_type_id) || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="数量" width="120">
          <template #default="scope">
            {{ formatQty(scope.row.quantity) }}
          </template>
        </el-table-column>
        <el-table-column label="关联项目" min-width="180">
          <template #default="scope">
            {{ toString(scope.row.project_name) || toString(scope.row.project_id) || "-" }}
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="220" show-overflow-tooltip>
          <template #default="scope">
            {{ toString(scope.row.remark) || "-" }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </el-card>

  <el-dialog v-model="consumptionDialogVisible" title="登记消耗品消耗" width="560px">
    <el-form label-width="110px">
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouse_id" filterable style="width: 100%">
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="消耗品类型" required>
        <el-select v-model="form.asset_type_id" filterable style="width: 100%">
          <el-option
            v-for="item in consumableTypes"
            :key="item.id"
            :label="`${item.type_name} (${item.type_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联项目">
        <el-select v-model="form.project_id" clearable filterable style="width: 100%">
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="消耗数量">
        <el-input-number v-model="form.quantity" :min="0.01" :precision="2" />
      </el-form-item>
      <el-form-item label="消耗日期" required>
        <el-date-picker
          v-model="form.consumed_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="consumptionDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitConsumption">提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.consumables {
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
}

.panel-title {
  font-weight: 600;
  color: #2a241d;
}

@media (max-width: 900px) {
  .head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
