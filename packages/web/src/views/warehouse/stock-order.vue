<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listAssetRentalTerms,
  listAssetTypes,
  type AssetRentalTerm,
  type AssetType
} from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  cancelStockOrder,
  createStockOrder,
  executeStockOrder,
  listStockOrders,
  listWarehouses,
  submitStockOrderApproval,
  type StockOrder,
  type StockOrderItemInput,
  type Warehouse
} from "@/api/warehouse";

defineOptions({ name: "WarehouseStockOrder" });

const loading = ref(false);
const rows = ref<StockOrder[]>([]);
const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const projects = ref<Project[]>([]);
const rentalTerms = ref<AssetRentalTerm[]>([]);

const filters = ref({ status: "", order_type: "" });
const assetKeyword = ref("");
const submitting = ref(false);
const actionId = ref<number | null>(null);

const form = ref({
  order_type: "outbound" as "inbound" | "outbound" | "transfer",
  project_id: undefined as number | undefined,
  from_warehouse_id: undefined as number | undefined,
  to_warehouse_id: undefined as number | undefined,
  rental_term_id: undefined as number | undefined,
  remark: "",
  items: [] as Array<{
    asset_type_id: number;
    quantity: number;
  }>
});

const filteredAssetTypes = computed(() => {
  const q = assetKeyword.value.trim().toLowerCase();
  if (!q) return assetTypes.value;
  return assetTypes.value.filter(item => {
    const source = `${item.type_name} ${item.type_code}`.toLowerCase();
    return source.includes(q);
  });
});

const canSubmit = computed(() => {
  return form.value.items.length > 0 && !submitting.value;
});

const activeRentalTerms = computed(() =>
  rentalTerms.value.filter(item => ["active", "overdue"].includes(item.status))
);

const rentalTermMap = computed(() => {
  const map: Record<number, AssetRentalTerm> = {};
  activeRentalTerms.value.forEach(item => {
    map[item.id] = item;
  });
  return map;
});

const orderTypeLabel = (value: StockOrder["order_type"]) => {
  if (value === "inbound") return "入库";
  if (value === "outbound") return "出库";
  return "调拨";
};

const statusTag = (status: string) => {
  if (status === "executed") return "success";
  if (status === "approved") return "primary";
  if (status === "pending_approval") return "warning";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "info";
  return "info";
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
  const rentalRes = await listAssetRentalTerms({ status: "active" });
  rentalTerms.value = rentalRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listStockOrders({
      status: filters.value.status || undefined,
      order_type: filters.value.order_type || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const resetCreator = () => {
  form.value = {
    order_type: "outbound",
    project_id: undefined,
    from_warehouse_id: undefined,
    to_warehouse_id: undefined,
    rental_term_id: undefined,
    remark: "",
    items: []
  };
};

const addAssetToCart = (assetTypeId: number) => {
  if (form.value.items.some(item => item.asset_type_id === assetTypeId)) {
    message("该资产类型已在制单清单中", { type: "info" });
    return;
  }
  form.value.items.push({ asset_type_id: assetTypeId, quantity: 1 });
};

const removeCartItem = (index: number) => {
  form.value.items.splice(index, 1);
};

const getAssetTypeName = (assetTypeId: number) => {
  const found = assetTypes.value.find(item => item.id === assetTypeId);
  return found ? found.type_name : `资产类型#${assetTypeId}`;
};

const validateOrder = () => {
  if (!form.value.items.length) {
    message("请先从左侧选择资产加入制单清单", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "outbound" && !form.value.from_warehouse_id) {
    message("出库单必须选择来源仓库", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "inbound" && !form.value.to_warehouse_id) {
    message("入库单必须选择目标仓库", { type: "warning" });
    return false;
  }
  if (
    form.value.order_type === "transfer" &&
    (!form.value.from_warehouse_id ||
      !form.value.to_warehouse_id ||
      form.value.from_warehouse_id === form.value.to_warehouse_id)
  ) {
    message("调拨单必须选择不同的来源/目标仓库", { type: "warning" });
    return false;
  }
  if (form.value.items.some(item => item.quantity <= 0)) {
    message("数量必须大于 0", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "outbound" && form.value.rental_term_id) {
    const term = rentalTermMap.value[form.value.rental_term_id];
    if (term?.status === "overdue") {
      message("该租赁周期已逾期，禁止继续出库", { type: "error" });
      return false;
    }
  }
  return true;
};

const submit = async () => {
  if (!validateOrder()) return;

  const items: StockOrderItemInput[] = form.value.items.map(item => ({
    asset_type_id: item.asset_type_id,
    quantity: item.quantity
  }));

  submitting.value = true;
  try {
    const result = await createStockOrder({
      order_type: form.value.order_type,
      project_id: form.value.project_id,
      from_warehouse_id: form.value.from_warehouse_id,
      to_warehouse_id: form.value.to_warehouse_id,
      rental_term_id: form.value.rental_term_id,
      remark: form.value.remark || undefined,
      items
    });
    message(`制单成功: ${result.data.order_no}`, { type: "success" });
    resetCreator();
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const submitApproval = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    await submitStockOrderApproval(row.id, {
      biz_summary: `${row.order_no} ${row.order_type}`
    });
    message("已提交审批", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const executeOrder = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    await executeStockOrder(row.id);
    message("执行成功", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const cancelOrder = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    await cancelStockOrder(row.id);
    message("已取消", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

onMounted(async () => {
  await loadMeta();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" class="order-creator" v-loading="loading">
    <template #header>
      <div class="order-creator__header">
        <div>
          <div class="title">出入库制单工作台</div>
          <div class="sub">左侧检索资源，右侧购物车式制单</div>
        </div>
      </div>
    </template>

    <div class="creator-layout">
      <div class="resource-panel">
        <el-input
          v-model="assetKeyword"
          clearable
          placeholder="搜索资产类型（名称/编码）"
        />

        <el-scrollbar max-height="540px" class="resource-list">
          <div
            v-for="asset in filteredAssetTypes"
            :key="asset.id"
            class="resource-item"
          >
            <div>
              <div class="resource-item__name">{{ asset.type_name }}</div>
              <div class="resource-item__meta">{{ asset.type_code }} · {{ asset.unit || "件" }}</div>
            </div>
            <el-button type="primary" plain @click="addAssetToCart(asset.id)">加入</el-button>
          </div>
        </el-scrollbar>
      </div>

      <div class="cart-panel">
        <el-form label-position="top">
          <el-row :gutter="10">
            <el-col :xs="24" :sm="8">
              <el-form-item label="调拨类型">
                <el-select v-model="form.order_type" style="width: 100%">
                  <el-option label="入库" value="inbound" />
                  <el-option label="出库" value="outbound" />
                  <el-option label="调拨" value="transfer" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="16">
              <el-form-item label="关联项目">
                <el-select
                  v-model="form.project_id"
                  clearable
                  filterable
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
            </el-col>
          </el-row>

          <el-row :gutter="10">
            <el-col :xs="24" :sm="24">
              <el-form-item label="关联租赁周期（可选）">
                <el-select
                  v-model="form.rental_term_id"
                  clearable
                  filterable
                  style="width: 100%"
                  placeholder="选择租赁周期以启用逾期校验与回库自动归还"
                >
                  <el-option
                    v-for="item in activeRentalTerms"
                    :key="item.id"
                    :label="`${item.rental_no} | 资产#${item.tracked_asset_id} | ${item.rental_mode === 'lease_in' ? '租入' : '外租'} | 到期${item.due_date}`"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="10">
            <el-col :xs="24" :sm="12">
              <el-form-item label="来源仓库">
                <el-select
                  v-model="form.from_warehouse_id"
                  clearable
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
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="目标仓库">
                <el-select
                  v-model="form.to_warehouse_id"
                  clearable
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
            </el-col>
          </el-row>

          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>

        <el-table :data="form.items" size="small" empty-text="请从左侧加入资产" border>
          <el-table-column label="资产类型" min-width="240">
            <template #default="scope">
              {{ getAssetTypeName(scope.row.asset_type_id) }}
            </template>
          </el-table-column>
          <el-table-column label="数量" width="150">
            <template #default="scope">
              <el-input-number
                v-model="scope.row.quantity"
                :min="0.01"
                :precision="2"
                :controls="true"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="scope">
              <el-button link type="danger" @click="removeCartItem(scope.$index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="cart-actions">
          <el-button @click="resetCreator">清空</el-button>
          <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">
            提交制单
          </el-button>
        </div>
      </div>
    </div>
  </el-card>

  <el-card shadow="never" class="order-list" v-loading="loading">
    <template #header>
      <div class="order-list__header">
        <span>出入库单列表</span>
        <el-form inline>
          <el-form-item label="类型">
            <el-select v-model="filters.order_type" clearable style="width: 140px">
              <el-option label="入库" value="inbound" />
              <el-option label="出库" value="outbound" />
              <el-option label="调拨" value="transfer" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="filters.status" clearable style="width: 160px">
              <el-option label="draft" value="draft" />
              <el-option label="pending_approval" value="pending_approval" />
              <el-option label="approved" value="approved" />
              <el-option label="executed" value="executed" />
              <el-option label="rejected" value="rejected" />
              <el-option label="cancelled" value="cancelled" />
            </el-select>
          </el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
        </el-form>
      </div>
    </template>

    <el-table :data="rows">
      <el-table-column prop="order_no" label="单号" width="170" />
      <el-table-column label="类型" width="90">
        <template #default="scope">
          {{ orderTypeLabel(scope.row.order_type) }}
        </template>
      </el-table-column>
      <el-table-column prop="project_id" label="项目ID" width="100" />
      <el-table-column prop="from_warehouse_id" label="来源仓库" width="110" />
      <el-table-column prop="to_warehouse_id" label="目标仓库" width="110" />
      <el-table-column label="租赁周期" width="130">
        <template #default="scope">
          {{ scope.row.rental_term_id || "-" }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="scope">
          <el-tag :type="statusTag(scope.row.status)">{{ scope.row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="190" />
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'draft'"
            link
            type="primary"
            :loading="actionId === scope.row.id"
            @click="submitApproval(scope.row)"
          >
            提交审批
          </el-button>
          <el-button
            v-if="scope.row.status === 'approved'"
            link
            type="success"
            :loading="actionId === scope.row.id"
            @click="executeOrder(scope.row)"
          >
            执行
          </el-button>
          <el-button
            v-if="scope.row.status === 'draft' || scope.row.status === 'pending_approval'"
            link
            type="danger"
            :loading="actionId === scope.row.id"
            @click="cancelOrder(scope.row)"
          >
            取消
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.order-creator,
.order-list {
  background: #fffaf2;
  margin-bottom: 12px;
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

.creator-layout {
  display: grid;
  grid-template-columns: 34% 66%;
  gap: 12px;
}

.resource-panel,
.cart-panel {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.resource-list {
  margin-top: 10px;
}

.resource-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #e8ddc8;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}

.resource-item__name {
  font-weight: 600;
  color: #2a241d;
}

.resource-item__meta {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.cart-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.order-list__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

@media (max-width: 980px) {
  .creator-layout {
    grid-template-columns: 1fr;
  }

  .order-list__header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
