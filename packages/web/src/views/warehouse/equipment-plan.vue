<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  confirmEquipmentPlan,
  createEquipmentPlan,
  getEquipmentRecommendation,
  listEquipmentPlans,
  listWarehouses,
  triggerEquipmentRecommend,
  type EquipmentPlan,
  type Warehouse
} from "@/api/warehouse";

defineOptions({ name: "WarehouseEquipmentPlan" });

const loading = ref(false);
const rows = ref<EquipmentPlan[]>([]);
const projects = ref<Project[]>([]);
const assetTypes = ref<AssetType[]>([]);
const warehouses = ref<Warehouse[]>([]);
const actionId = ref<number | null>(null);

const dialogVisible = ref(false);
const submitting = ref(false);
const form = ref({
  project_id: undefined as number | undefined,
  remark: "",
  items: [
    { asset_type_id: undefined as number | undefined, planned_qty: 1 }
  ] as Array<{
    asset_type_id: number | undefined;
    planned_qty: number;
  }>
});

const recommendationDialogVisible = ref(false);
const recommendationText = ref("");

const loadMeta = async () => {
  const [projectRes, typeRes, warehouseRes] = await Promise.all([
    listProjects({ page: 1, pageSize: 500 }),
    listAssetTypes(),
    listWarehouses()
  ]);
  projects.value = projectRes.data;
  assetTypes.value = typeRes.data;
  warehouses.value = warehouseRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listEquipmentPlans();
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    project_id: undefined,
    remark: "",
    items: [{ asset_type_id: undefined, planned_qty: 1 }]
  };
  dialogVisible.value = true;
};

const addItem = () => {
  form.value.items.push({ asset_type_id: undefined, planned_qty: 1 });
};

const removeItem = (index: number) => {
  form.value.items.splice(index, 1);
};

const submit = async () => {
  if (!form.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }
  const items = form.value.items
    .filter(item => item.asset_type_id && item.planned_qty > 0)
    .map(item => ({
      asset_type_id: item.asset_type_id as number,
      planned_qty: item.planned_qty
    }));
  if (items.length === 0) {
    message("请至少填写一个有效明细", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const result = await createEquipmentPlan({
      project_id: form.value.project_id,
      remark: form.value.remark || undefined,
      items
    });
    message(`设备规划创建成功: ${result.data.plan_no}`, { type: "success" });
    dialogVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const trigger = async (row: EquipmentPlan) => {
  actionId.value = row.id;
  try {
    await triggerEquipmentRecommend(row.id);
    message("已触发AI推荐", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const viewRecommendation = async (row: EquipmentPlan) => {
  actionId.value = row.id;
  try {
    const result = await getEquipmentRecommendation(row.id);
    recommendationText.value = JSON.stringify(result.data, null, 2);
    recommendationDialogVisible.value = true;
  } finally {
    actionId.value = null;
  }
};

const confirmPlan = async (row: EquipmentPlan) => {
  if (warehouses.value.length === 0) {
    message("暂无仓库，无法确认规划", { type: "warning" });
    return;
  }
  actionId.value = row.id;
  try {
    const result = await confirmEquipmentPlan(row.id, {
      from_warehouse_id: warehouses.value[0].id
    });
    message(`已生成出库单: ${result.data.order_no}`, { type: "success" });
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
        <span>项目设备规划</span>
        <el-button type="primary" @click="openCreate">新建规划</el-button>
      </div>
    </template>

    <el-table :data="rows" :loading="loading">
      <el-table-column prop="plan_no" label="规划单号" width="170" />
      <el-table-column prop="project_id" label="项目ID" width="100" />
      <el-table-column prop="plan_status" label="规划状态" width="120" />
      <el-table-column prop="ai_status" label="AI状态" width="100" />
      <el-table-column prop="stock_order_id" label="出库单ID" width="120" />
      <el-table-column prop="updated_at" label="更新时间" width="190" />
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            :loading="actionId === scope.row.id"
            @click="trigger(scope.row)"
          >
            触发推荐
          </el-button>
          <el-button
            link
            :loading="actionId === scope.row.id"
            @click="viewRecommendation(scope.row)"
          >
            查看结果
          </el-button>
          <el-button
            link
            type="success"
            :loading="actionId === scope.row.id"
            @click="confirmPlan(scope.row)"
          >
            确认并生成出库
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialogVisible" title="新建设备规划" width="760px">
    <el-form label-width="100px">
      <el-form-item label="项目" required>
        <el-select v-model="form.project_id" filterable style="width: 100%">
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
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
        <el-input-number
          v-model="item.planned_qty"
          :min="0.01"
          :precision="2"
        />
        <el-button :disabled="form.items.length <= 1" @click="removeItem(index)"
          >删除</el-button
        >
      </div>
      <el-button @click="addItem">新增明细</el-button>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit"
        >创建</el-button
      >
    </template>
  </el-dialog>

  <el-dialog
    v-model="recommendationDialogVisible"
    title="AI推荐结果"
    width="760px"
  >
    <pre style="white-space: pre-wrap; word-break: break-word">{{
      recommendationText
    }}</pre>
  </el-dialog>
</template>
