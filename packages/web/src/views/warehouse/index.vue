<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  createWarehouse,
  deleteWarehouse,
  listInventory,
  listInventoryAlerts,
  listStockOrders,
  listWarehouses,
  type Warehouse,
  updateWarehouse
} from "@/api/warehouse";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "WarehouseIndex" });

const loading = ref(false);
const list = ref<Warehouse[]>([]);
const keyword = ref("");
const router = useRouter();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const kpis = ref({
  warehouseCount: 0,
  pendingOrderCount: 0,
  alertCount: 0,
  inventoryCount: 0
});

const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref<number | null>(null);
const form = ref({
  warehouse_code: "",
  warehouse_name: "",
  location: "",
  manager_userid: "",
  status: "active",
  remark: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const [warehouseRes, stockOrderRes, alertRes, inventoryRes] =
      await Promise.all([
        listWarehouses({
          keyword: keyword.value || undefined
        }),
        listStockOrders(),
        listInventoryAlerts(),
        listInventory()
      ]);
    const pendingOrderCount = stockOrderRes.data.filter(item =>
      ["draft", "pending_approval", "approved"].includes(item.status)
    ).length;

    kpis.value = {
      warehouseCount: warehouseRes.data.length,
      pendingOrderCount,
      alertCount: alertRes.data.length,
      inventoryCount: inventoryRes.data.length
    };

    const result = warehouseRes;
    list.value = result.data;
  } finally {
    loading.value = false;
  }
};

const goTo = (path: string) => {
  router.push(path);
};

const openCreate = () => {
  editingId.value = null;
  form.value = {
    warehouse_code: "",
    warehouse_name: "",
    location: "",
    manager_userid: "",
    status: "active",
    remark: ""
  };
  dialogVisible.value = true;
};

const openEdit = (row: Warehouse) => {
  editingId.value = row.id;
  form.value = {
    warehouse_code: row.warehouse_code,
    warehouse_name: row.warehouse_name,
    location: row.location ?? "",
    manager_userid: row.manager_userid ?? "",
    status: row.status,
    remark: row.remark ?? ""
  };
  dialogVisible.value = true;
};

const submit = async () => {
  if (!form.value.warehouse_name.trim() || !form.value.warehouse_code.trim()) {
    message("请填写仓库编码和仓库名称", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateWarehouse(editingId.value, {
        warehouse_name: form.value.warehouse_name,
        location: form.value.location || undefined,
        manager_userid: form.value.manager_userid || undefined,
        status: form.value.status,
        remark: form.value.remark || undefined
      });
      message("仓库更新成功", { type: "success" });
    } else {
      await createWarehouse({
        warehouse_code: form.value.warehouse_code,
        warehouse_name: form.value.warehouse_name,
        location: form.value.location || undefined,
        manager_userid: form.value.manager_userid || undefined,
        remark: form.value.remark || undefined
      });
      message("仓库创建成功", { type: "success" });
    }
    dialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const onDelete = async (row: Warehouse) => {
  await deleteWarehouse(row.id);
  message("仓库已删除", { type: "success" });
  await loadData();
};

onMounted(loadData);
onMounted(loadWecomUsers);
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
        <span>仓库管理</span>
        <el-button type="primary" @click="openCreate">新增仓库</el-button>
      </div>
    </template>

    <el-row :gutter="10" class="kpi-row">
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card">
          <div class="kpi-label">仓库数量</div>
          <div class="kpi-value">{{ kpis.warehouseCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card kpi-card--warn">
          <div class="kpi-label">待处理制单</div>
          <div class="kpi-value">{{ kpis.pendingOrderCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card kpi-card--danger">
          <div class="kpi-label">库存预警</div>
          <div class="kpi-value">{{ kpis.alertCount }}</div>
        </div>
      </el-col>
      <el-col :md="6" :sm="12" :xs="24">
        <div class="kpi-card kpi-card--ok">
          <div class="kpi-label">库存条目</div>
          <div class="kpi-value">{{ kpis.inventoryCount }}</div>
        </div>
      </el-col>
    </el-row>

    <div class="entry-row">
      <el-button type="primary" plain @click="goTo('/warehouse/stock-order')"
        >出入库制单</el-button
      >
      <el-button type="primary" plain @click="goTo('/warehouse/dispatch')"
        >调度看板</el-button
      >
      <el-button type="primary" plain @click="goTo('/warehouse/inventory')"
        >库存与预警</el-button
      >
      <el-button type="primary" plain @click="goTo('/asset/list')"
        >资产设备查验</el-button
      >
    </div>

    <el-form inline>
      <el-form-item label="关键字">
        <el-input v-model="keyword" clearable placeholder="编码/名称/位置" />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="warehouse_code" label="仓库编码" width="150" />
      <el-table-column prop="warehouse_name" label="仓库名称" min-width="150" />
      <el-table-column prop="location" label="位置" min-width="160" />
      <el-table-column prop="manager_userid" label="负责人" width="140" />
      <el-table-column label="状态" width="100">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column
        prop="remark"
        label="备注"
        min-width="160"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openEdit(scope.row)"
            >编辑</el-button
          >
          <el-button link type="danger" @click="onDelete(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog
    v-model="dialogVisible"
    :title="editingId ? '编辑仓库' : '新增仓库'"
    width="560px"
  >
    <el-form label-width="100px">
      <el-form-item label="仓库编码" required>
        <el-input
          v-model="form.warehouse_code"
          :disabled="Boolean(editingId)"
        />
      </el-form-item>
      <el-form-item label="仓库名称" required>
        <el-input v-model="form.warehouse_name" />
      </el-form-item>
      <el-form-item label="位置">
        <el-input v-model="form.location" />
      </el-form-item>
      <el-form-item label="负责人">
        <el-select
          v-model="form.manager_userid"
          clearable
          filterable
          placeholder="选择公司人员"
          style="width: 100%"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="editingId" label="状态">
        <el-select v-model="form.status" style="width: 160px">
          <el-option label="active" value="active" />
          <el-option label="inactive" value="inactive" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit"
        >保存</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.kpi-row {
  margin-bottom: 12px;
}

.kpi-card {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.kpi-card--warn {
  border-color: #f3d19e;
}

.kpi-card--danger {
  border-color: #f6b6b6;
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

.entry-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
