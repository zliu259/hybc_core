<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
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

const filters = ref({ status: "", order_type: "" });

const createDialogVisible = ref(false);
const submitting = ref(false);
const actionId = ref<number | null>(null);

const form = ref({
  order_type: "outbound" as "inbound" | "outbound" | "transfer",
  project_id: undefined as number | undefined,
  from_warehouse_id: undefined as number | undefined,
  to_warehouse_id: undefined as number | undefined,
  remark: "",
  items: [
    { asset_type_id: undefined as number | undefined, quantity: 1 }
  ] as Array<{
    asset_type_id: number | undefined;
    quantity: number;
  }>
});

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
    const result = await listStockOrders({
      status: filters.value.status || undefined,
      order_type: filters.value.order_type || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    order_type: "outbound",
    project_id: undefined,
    from_warehouse_id: undefined,
    to_warehouse_id: undefined,
    remark: "",
    items: [{ asset_type_id: undefined, quantity: 1 }]
  };
  createDialogVisible.value = true;
};

const addItem = () => {
  form.value.items.push({ asset_type_id: undefined, quantity: 1 });
};

const removeItem = (index: number) => {
  form.value.items.splice(index, 1);
};

const submit = async () => {
  if (form.value.items.length === 0) {
    message("请至少添加一个明细", { type: "warning" });
    return;
  }

  const items: StockOrderItemInput[] = form.value.items
    .filter(item => item.asset_type_id && item.quantity > 0)
    .map(item => ({
      asset_type_id: item.asset_type_id,
      quantity: item.quantity
    }));

  if (items.length === 0) {
    message("请填写有效明细", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const result = await createStockOrder({
      order_type: form.value.order_type,
      project_id: form.value.project_id,
      from_warehouse_id: form.value.from_warehouse_id,
      to_warehouse_id: form.value.to_warehouse_id,
      remark: form.value.remark || undefined,
      items
    });
    message(`出入库单创建成功: ${result.data.order_no}`, { type: "success" });
    createDialogVisible.value = false;
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
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>出入库单管理</span>
        <el-button type="primary" @click="openCreate">新建出入库单</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="类型">
        <el-select v-model="filters.order_type" clearable style="width: 140px">
          <el-option label="inbound" value="inbound" />
          <el-option label="outbound" value="outbound" />
          <el-option label="transfer" value="transfer" />
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

    <el-table :data="rows" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="order_no" label="单号" width="160" />
      <el-table-column prop="order_type" label="类型" width="100" />
      <el-table-column prop="project_id" label="项目ID" width="100" />
      <el-table-column prop="from_warehouse_id" label="来源仓库" width="110" />
      <el-table-column prop="to_warehouse_id" label="目标仓库" width="110" />
      <el-table-column prop="status" label="状态" width="130" />
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
            v-if="
              scope.row.status === 'draft' ||
              scope.row.status === 'pending_approval'
            "
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

  <el-dialog v-model="createDialogVisible" title="新建出入库单" width="760px">
    <el-form label-width="100px">
      <el-form-item label="单据类型">
        <el-select v-model="form.order_type" style="width: 180px">
          <el-option label="inbound" value="inbound" />
          <el-option label="outbound" value="outbound" />
          <el-option label="transfer" value="transfer" />
        </el-select>
      </el-form-item>
      <el-form-item label="项目">
        <el-select
          v-model="form.project_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
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
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
      <el-divider>明细</el-divider>
      <div
        v-for="(item, index) in form.items"
        :key="index"
        style="display: flex; gap: 8px; margin-bottom: 8px"
      >
        <el-select
          v-model="item.asset_type_id"
          filterable
          placeholder="资产类型"
          style="flex: 1"
        >
          <el-option
            v-for="t in assetTypes"
            :key="t.id"
            :label="t.type_name"
            :value="t.id"
          />
        </el-select>
        <el-input-number v-model="item.quantity" :min="0.01" :precision="2" />
        <el-button :disabled="form.items.length <= 1" @click="removeItem(index)"
          >删除</el-button
        >
      </div>
      <el-button @click="addItem">新增明细</el-button>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit"
        >创建</el-button
      >
    </template>
  </el-dialog>
</template>
