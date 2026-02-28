<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
import {
  analyzeInventoryAlert,
  createConsumption,
  listInventory,
  listInventoryAlerts,
  listWarehouses,
  type InventoryRow,
  type Warehouse
} from "@/api/warehouse";
import { useProjectOptions } from "@/composables/useProjectOptions";

defineOptions({ name: "WarehouseInventory" });

const loading = ref(false);
const rows = ref<InventoryRow[]>([]);
const alerts = ref<InventoryRow[]>([]);
const alertLoadingId = ref<number | null>(null);
const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const { projects, loadProjects } = useProjectOptions();

const filters = ref({
  warehouse_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined
});

const consumptionDialogVisible = ref(false);
const submitting = ref(false);
const consumptionForm = ref({
  warehouse_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined,
  quantity: 1,
  consumed_date: "",
  remark: ""
});

const loadMeta = async () => {
  const [warehouseRes, typeRes] = await Promise.all([
    listWarehouses(),
    listAssetTypes()
  ]);
  warehouses.value = warehouseRes.data;
  assetTypes.value = typeRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [inventoryRes, alertRes] = await Promise.all([
      listInventory({
      warehouse_id: filters.value.warehouse_id,
      asset_type_id: filters.value.asset_type_id
      }),
      listInventoryAlerts()
    ]);
    rows.value = inventoryRes.data;
    alerts.value = alertRes.data;
  } finally {
    loading.value = false;
  }
};

const triggerAlertAnalyze = async (row: InventoryRow) => {
  alertLoadingId.value = row.id;
  try {
    await analyzeInventoryAlert(row.id);
    message("已触发 AI 分析", { type: "success" });
  } finally {
    alertLoadingId.value = null;
  }
};

const openConsumption = () => {
  consumptionForm.value = {
    warehouse_id: undefined,
    project_id: undefined,
    asset_type_id: undefined,
    quantity: 1,
    consumed_date: "",
    remark: ""
  };
  consumptionDialogVisible.value = true;
};

const submitConsumption = async () => {
  if (
    !consumptionForm.value.warehouse_id ||
    !consumptionForm.value.asset_type_id ||
    !consumptionForm.value.consumed_date
  ) {
    message("请填写仓库、资产类型、消耗日期", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    await createConsumption({
      warehouse_id: consumptionForm.value.warehouse_id,
      project_id: consumptionForm.value.project_id,
      asset_type_id: consumptionForm.value.asset_type_id,
      quantity: consumptionForm.value.quantity,
      consumed_date: consumptionForm.value.consumed_date,
      remark: consumptionForm.value.remark || undefined
    });
    message("耗材登记成功", { type: "success" });
    consumptionDialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadMeta(), loadProjects()]);
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>库存概览</span>
        <el-button type="primary" @click="openConsumption"
          >登记耗材消耗</el-button
        >
      </div>
    </template>

    <el-form inline>
      <el-form-item label="仓库">
        <el-select
          v-model="filters.warehouse_id"
          clearable
          filterable
          style="width: 180px"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="资产类型">
        <el-select
          v-model="filters.asset_type_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="item.type_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="rows" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="warehouse_name" label="仓库" min-width="140" />
      <el-table-column prop="type_name" label="资产类型" min-width="140" />
      <el-table-column prop="quantity" label="库存数量" width="110" />
      <el-table-column prop="unit" label="单位" width="90" />
      <el-table-column prop="min_stock" label="最小库存" width="110" />
      <el-table-column prop="updated_at" label="更新时间" width="190" />
    </el-table>

    <el-card shadow="never" class="alert-card" style="margin-top: 12px">
      <template #header>
        <div class="alert-head">库存预警</div>
      </template>
      <el-table :data="alerts" size="small" empty-text="当前无预警">
        <el-table-column prop="warehouse_name" label="仓库" min-width="140" />
        <el-table-column prop="type_name" label="资产类型" min-width="160" />
        <el-table-column prop="quantity" label="当前库存" width="100" />
        <el-table-column prop="min_stock" label="最小库存" width="100" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              :loading="alertLoadingId === scope.row.id"
              @click="triggerAlertAnalyze(scope.row)"
            >
              AI分析
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </el-card>

  <el-dialog
    v-model="consumptionDialogVisible"
    title="耗材消耗登记"
    width="560px"
  >
    <el-form label-width="110px">
      <el-form-item label="仓库" required>
        <el-select
          v-model="consumptionForm.warehouse_id"
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
      <el-form-item label="资产类型" required>
        <el-select
          v-model="consumptionForm.asset_type_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="item.type_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="所属项目">
        <el-select
          v-model="consumptionForm.project_id"
          clearable
          filterable
          placeholder="按时间排序选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="消耗数量">
        <el-input-number
          v-model="consumptionForm.quantity"
          :min="0.01"
          :precision="2"
        />
      </el-form-item>
      <el-form-item label="消耗日期" required>
        <el-date-picker
          v-model="consumptionForm.consumed_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="consumptionForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="consumptionDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitConsumption"
        >提交</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.alert-head {
  font-weight: 600;
  color: #2a241d;
}

.alert-card {
  border: 1px solid #e8ddc8;
}
</style>
