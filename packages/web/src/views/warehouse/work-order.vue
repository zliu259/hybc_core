<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listTrackedAssets,
  listTrackedAssetConfigurations,
  type TrackedAsset,
  type TrackedAssetConfiguration
} from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  cancelWarehouseAssetWorkOrder,
  completeWarehouseAssetWorkOrder,
  createWarehouseAssetWorkOrder,
  listStockOrders,
  listWarehouseAssetWorkOrders,
  listWarehouses,
  startWarehouseAssetWorkOrder,
  submitWarehouseAssetWorkOrderApproval,
  updateWarehouseAssetWorkOrder,
  type StockOrder,
  type Warehouse,
  type WarehouseAssetWorkOrder
} from "@/api/warehouse";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "WarehouseWorkOrder" });

const loading = ref(false);
const submitting = ref(false);
const actionId = ref<number | null>(null);
const editVisible = ref(false);
const completeVisible = ref(false);

const rows = ref<WarehouseAssetWorkOrder[]>([]);
const assets = ref<TrackedAsset[]>([]);
const configurations = ref<TrackedAssetConfiguration[]>([]);
const stockOrders = ref<StockOrder[]>([]);
const projects = ref<Project[]>([]);
const warehouses = ref<Warehouse[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const filters = ref<{
  status?: WarehouseAssetWorkOrder["status"];
  work_order_type?: WarehouseAssetWorkOrder["work_order_type"];
  blocking_flag?: 0 | 1;
}>({});

const typeOptions: Array<{
  label: string;
  value: WarehouseAssetWorkOrder["work_order_type"];
}> = [
  { label: "检查", value: "inspection" },
  { label: "维护", value: "maintenance" },
  { label: "保养", value: "servicing" },
  { label: "改装", value: "modification" },
  { label: "报废", value: "scrapping" }
];

const form = ref({
  work_order_type: "inspection" as WarehouseAssetWorkOrder["work_order_type"],
  tracked_asset_id: undefined as number | undefined,
  tracked_asset_configuration_id: undefined as number | undefined,
  stock_order_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  warehouse_id: undefined as number | undefined,
  assignee_userid: "",
  blocking_flag: 1,
  scheduled_date: "",
  remark: ""
});

const editForm = ref<{
  id: number | null;
  assignee_userid: string;
  blocking_flag: number;
  scheduled_date: string;
  result_summary: string;
  remark: string;
}>({
  id: null,
  assignee_userid: "",
  blocking_flag: 1,
  scheduled_date: "",
  result_summary: "",
  remark: ""
});

const completeForm = ref({
  id: null as number | null,
  result_summary: ""
});

const assetLabelMap = computed(() => {
  return Object.fromEntries(
    assets.value.map(item => [item.id, `${item.asset_code} · ${item.asset_name}`])
  ) as Record<number, string>;
});

const configurationLabelMap = computed(() => {
  return Object.fromEntries(
    configurations.value.map(item => [
      item.id,
      `${item.configuration_code}${item.whole_machine_code ? ` · ${item.whole_machine_code}` : ""}`
    ])
  ) as Record<number, string>;
});

const stockOrderLabelMap = computed(() => {
  return Object.fromEntries(
    stockOrders.value.map(item => [item.id, `${item.order_no} · ${item.order_type}`])
  ) as Record<number, string>;
});

const typeLabelMap = Object.fromEntries(
  typeOptions.map(item => [item.value, item.label])
) as Record<WarehouseAssetWorkOrder["work_order_type"], string>;

const statusTag = (status: WarehouseAssetWorkOrder["status"]) => {
  if (status === "completed") return "success";
  if (status === "approved") return "primary";
  if (status === "pending_approval") return "warning";
  if (status === "in_progress") return "info";
  if (status === "cancelled") return "danger";
  return "info";
};

const loadMeta = async () => {
  const [assetRes, configRes, stockOrderRes, projectRes, warehouseRes] = await Promise.all([
    listTrackedAssets({ page: 1, pageSize: 500 }),
    listTrackedAssetConfigurations(),
    listStockOrders(),
    listProjects({ page: 1, pageSize: 500 }),
    listWarehouses()
  ]);

  assets.value = assetRes.data;
  configurations.value = configRes.data;
  stockOrders.value = stockOrderRes.data;
  projects.value = projectRes.data;
  warehouses.value = warehouseRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listWarehouseAssetWorkOrders(filters.value);
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const resetCreator = () => {
  form.value = {
    work_order_type: "inspection",
    tracked_asset_id: undefined,
    tracked_asset_configuration_id: undefined,
    stock_order_id: undefined,
    project_id: undefined,
    warehouse_id: undefined,
    assignee_userid: "",
    blocking_flag: 1,
    scheduled_date: "",
    remark: ""
  };
};

const validateCreateForm = () => {
  if (
    !form.value.tracked_asset_id &&
    !form.value.tracked_asset_configuration_id &&
    !form.value.stock_order_id
  ) {
    message("请至少关联资产、组合配置或出入库单之一", { type: "warning" });
    return false;
  }
  return true;
};

const submit = async () => {
  if (!validateCreateForm()) return;
  submitting.value = true;
  try {
    const result = await createWarehouseAssetWorkOrder({
      work_order_type: form.value.work_order_type,
      tracked_asset_id: form.value.tracked_asset_id,
      tracked_asset_configuration_id: form.value.tracked_asset_configuration_id,
      stock_order_id: form.value.stock_order_id,
      project_id: form.value.project_id,
      warehouse_id: form.value.warehouse_id,
      assignee_userid: form.value.assignee_userid || undefined,
      blocking_flag: form.value.blocking_flag,
      scheduled_date: form.value.scheduled_date || undefined,
      remark: form.value.remark || undefined
    });
    message(`工单已创建：${result.data.work_order_no}`, { type: "success" });
    resetCreator();
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const submitApproval = async (row: WarehouseAssetWorkOrder) => {
  actionId.value = row.id;
  try {
    await submitWarehouseAssetWorkOrderApproval(row.id, {
      biz_summary: `${row.work_order_no} ${typeLabelMap[row.work_order_type]}`
    });
    message("已提交审批", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const startWorkOrder = async (row: WarehouseAssetWorkOrder) => {
  actionId.value = row.id;
  try {
    await startWarehouseAssetWorkOrder(row.id);
    message("工单已开始", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const openComplete = (row: WarehouseAssetWorkOrder) => {
  completeForm.value = {
    id: row.id,
    result_summary: row.result_summary || ""
  };
  completeVisible.value = true;
};

const completeWorkOrder = async () => {
  if (!completeForm.value.id) return;
  actionId.value = completeForm.value.id;
  try {
    await completeWarehouseAssetWorkOrder(completeForm.value.id, {
      result_summary: completeForm.value.result_summary || undefined
    });
    message("工单已完成", { type: "success" });
    completeVisible.value = false;
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const cancelWorkOrder = async (row: WarehouseAssetWorkOrder) => {
  actionId.value = row.id;
  try {
    await cancelWarehouseAssetWorkOrder(row.id);
    message("工单已取消", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const openEdit = (row: WarehouseAssetWorkOrder) => {
  editForm.value = {
    id: row.id,
    assignee_userid: row.assignee_userid || "",
    blocking_flag: row.blocking_flag,
    scheduled_date: row.scheduled_date || "",
    result_summary: row.result_summary || "",
    remark: row.remark || ""
  };
  editVisible.value = true;
};

const saveEdit = async () => {
  if (!editForm.value.id) return;
  actionId.value = editForm.value.id;
  try {
    await updateWarehouseAssetWorkOrder(editForm.value.id, {
      assignee_userid: editForm.value.assignee_userid || null,
      blocking_flag: editForm.value.blocking_flag,
      scheduled_date: editForm.value.scheduled_date || null,
      result_summary: editForm.value.result_summary || null,
      remark: editForm.value.remark || null
    });
    message("工单已更新", { type: "success" });
    editVisible.value = false;
    await loadData();
  } finally {
    actionId.value = null;
  }
};

onMounted(async () => {
  await Promise.all([loadMeta(), loadWecomUsers()]);
  await loadData();
});
</script>

<template>
  <el-card shadow="never" class="work-order work-order--creator">
    <template #header>
      <div>
        <div class="work-order__title">资产工单中心</div>
        <div class="work-order__sub">覆盖检查、维护、保养、改装与报废，支持审批与阻塞控制</div>
      </div>
    </template>

    <el-form label-position="top">
      <el-row :gutter="12">
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="工单类型">
            <el-select v-model="form.work_order_type" style="width: 100%">
              <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="关联资产">
            <el-select v-model="form.tracked_asset_id" clearable filterable style="width: 100%">
              <el-option v-for="item in assets" :key="item.id" :label="`${item.asset_code} · ${item.asset_name}`" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="组合配置">
            <el-select v-model="form.tracked_asset_configuration_id" clearable filterable style="width: 100%">
              <el-option
                v-for="item in configurations"
                :key="item.id"
                :label="`${item.configuration_code}${item.whole_machine_code ? ` · ${item.whole_machine_code}` : ''}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="关联出入库单">
            <el-select v-model="form.stock_order_id" clearable filterable style="width: 100%">
              <el-option v-for="item in stockOrders" :key="item.id" :label="`${item.order_no} · ${item.order_type}`" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="项目">
            <el-select v-model="form.project_id" clearable filterable style="width: 100%">
              <el-option v-for="item in projects" :key="item.id" :label="`${item.project_name} (${item.project_code})`" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="仓库">
            <el-select v-model="form.warehouse_id" clearable filterable style="width: 100%">
              <el-option v-for="item in warehouses" :key="item.id" :label="item.warehouse_name" :value="item.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="负责人">
            <el-select v-model="form.assignee_userid" clearable filterable style="width: 100%">
              <el-option v-for="item in wecomUsers" :key="item.userid" :label="`${item.name} (${item.userid})`" :value="item.userid" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :lg="6" :md="8" :sm="12" :xs="24">
          <el-form-item label="计划日期">
            <el-date-picker v-model="form.scheduled_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="24">
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" />
          </el-form-item>
        </el-col>
      </el-row>

      <div class="work-order__actions">
        <el-switch
          :model-value="form.blocking_flag === 1"
          active-text="阻塞出库"
          inactive-text="不阻塞出库"
          @update:model-value="form.blocking_flag = $event ? 1 : 0"
        />
        <div class="work-order__actions-right">
          <el-button @click="resetCreator">重置</el-button>
          <el-button type="primary" :loading="submitting" @click="submit">创建工单</el-button>
        </div>
      </div>
    </el-form>
  </el-card>

  <el-card v-loading="loading" shadow="never" class="work-order">
    <template #header>
      <div class="work-order__list-header">
        <span>工单列表</span>
        <el-form inline>
          <el-form-item label="类型">
            <el-select v-model="filters.work_order_type" clearable style="width: 150px">
              <el-option v-for="item in typeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="filters.status" clearable style="width: 160px">
              <el-option label="draft" value="draft" />
              <el-option label="pending_approval" value="pending_approval" />
              <el-option label="approved" value="approved" />
              <el-option label="in_progress" value="in_progress" />
              <el-option label="completed" value="completed" />
              <el-option label="cancelled" value="cancelled" />
            </el-select>
          </el-form-item>
          <el-form-item label="阻塞">
            <el-select v-model="filters.blocking_flag" clearable style="width: 120px">
              <el-option label="是" :value="1" />
              <el-option label="否" :value="0" />
            </el-select>
          </el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
        </el-form>
      </div>
    </template>

    <el-table :data="rows">
      <el-table-column prop="work_order_no" label="工单编号" width="170" />
      <el-table-column label="类型" width="100">
        <template #default="scope">{{ typeLabelMap[scope.row.work_order_type] }}</template>
      </el-table-column>
      <el-table-column label="关联资产" min-width="180">
        <template #default="scope">
          {{ scope.row.tracked_asset_id ? assetLabelMap[scope.row.tracked_asset_id] || `#${scope.row.tracked_asset_id}` : "-" }}
        </template>
      </el-table-column>
      <el-table-column label="组合配置" min-width="170">
        <template #default="scope">
          {{ scope.row.tracked_asset_configuration_id ? configurationLabelMap[scope.row.tracked_asset_configuration_id] || `#${scope.row.tracked_asset_configuration_id}` : "-" }}
        </template>
      </el-table-column>
      <el-table-column label="出入库单" min-width="150">
        <template #default="scope">
          {{ scope.row.stock_order_id ? stockOrderLabelMap[scope.row.stock_order_id] || `#${scope.row.stock_order_id}` : "-" }}
        </template>
      </el-table-column>
      <el-table-column prop="assignee_userid" label="负责人" width="130" />
      <el-table-column label="阻塞" width="80">
        <template #default="scope">{{ scope.row.blocking_flag === 1 ? "是" : "否" }}</template>
      </el-table-column>
      <el-table-column label="状态" width="130">
        <template #default="scope">
          <el-tag :type="statusTag(scope.row.status)">{{ scope.row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="scheduled_date" label="计划日期" width="120" />
      <el-table-column prop="updated_at" label="更新时间" width="180" />
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'draft'"
            link
            type="primary"
            :loading="actionId === scope.row.id"
            @click="submitApproval(scope.row)"
          >
            提审
          </el-button>
          <el-button
            v-if="scope.row.status === 'draft' || scope.row.status === 'approved'"
            link
            type="success"
            :loading="actionId === scope.row.id"
            @click="startWorkOrder(scope.row)"
          >
            开始
          </el-button>
          <el-button
            v-if="scope.row.status === 'in_progress'"
            link
            type="success"
            :loading="actionId === scope.row.id"
            @click="openComplete(scope.row)"
          >
            完成
          </el-button>
          <el-button
            v-if="scope.row.status !== 'completed' && scope.row.status !== 'cancelled'"
            link
            type="danger"
            :loading="actionId === scope.row.id"
            @click="cancelWorkOrder(scope.row)"
          >
            取消
          </el-button>
          <el-button link type="info" @click="openEdit(scope.row)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="editVisible" title="编辑工单" width="520px">
    <el-form label-width="110px">
      <el-form-item label="负责人">
        <el-select v-model="editForm.assignee_userid" clearable filterable style="width: 100%">
          <el-option v-for="item in wecomUsers" :key="item.userid" :label="`${item.name} (${item.userid})`" :value="item.userid" />
        </el-select>
      </el-form-item>
      <el-form-item label="计划日期">
        <el-date-picker v-model="editForm.scheduled_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
      </el-form-item>
      <el-form-item label="阻塞出库">
        <el-switch :model-value="editForm.blocking_flag === 1" @update:model-value="editForm.blocking_flag = $event ? 1 : 0" />
      </el-form-item>
      <el-form-item label="结果摘要">
        <el-input v-model="editForm.result_summary" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="editForm.remark" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="actionId === editForm.id" @click="saveEdit">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="completeVisible" title="完成工单" width="480px">
    <el-form label-width="100px">
      <el-form-item label="结果摘要">
        <el-input v-model="completeForm.result_summary" type="textarea" :rows="3" placeholder="填写检查/维护/改装结果" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="completeVisible = false">取消</el-button>
      <el-button type="primary" :loading="actionId === completeForm.id" @click="completeWorkOrder">确认完成</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.work-order {
  background: #fffaf2;
  margin-bottom: 12px;
}

.work-order__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.work-order__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.work-order__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.work-order__actions-right {
  display: flex;
  gap: 8px;
}

.work-order__list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

@media (max-width: 960px) {
  .work-order__list-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .work-order__actions {
    align-items: flex-start;
  }
}
</style>
