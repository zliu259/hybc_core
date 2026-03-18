<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  createTrackedAsset,
  listAssetTypes,
  listTrackedAssets,
  type AssetType,
  type TrackedAsset
} from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import { listWarehouses, type Warehouse } from "@/api/warehouse";

defineOptions({ name: "AssetList" });

const router = useRouter();
const loading = ref(false);
const list = ref<TrackedAsset[]>([]);
const assetTypes = ref<AssetType[]>([]);
const projects = ref<Project[]>([]);
const warehouses = ref<Warehouse[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  asset_type_id: undefined as number | undefined,
  status: "",
  project_id: undefined as number | undefined,
  warehouse_id: undefined as number | undefined,
  ownership_type: "" as "" | "owned" | "leased_in",
  keyword: ""
});

const typeMap = computed(() => {
  const map: Record<number, string> = {};
  assetTypes.value.forEach(item => {
    map[item.id] = item.type_name;
  });
  return map;
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const warehouseMap = computed(() => {
  const map: Record<number, string> = {};
  warehouses.value.forEach(item => {
    map[item.id] = item.warehouse_name;
  });
  return map;
});

const createDialogVisible = ref(false);
const creating = ref(false);
const form = ref({
  asset_type_id: undefined as number | undefined,
  asset_name: "",
  brand: "",
  model: "",
  serial_no: "",
  current_project_id: undefined as number | undefined,
  current_warehouse_id: undefined as number | undefined,
  current_location: "",
  purchased_date: "",
  properties_json: '{"spec":""}',
  ownership_type: "owned" as "owned" | "leased_in"
});

const loadMeta = async () => {
  const [typeRes, projectRes, warehouseRes] = await Promise.all([
    listAssetTypes({ tracked_flag: 1 }),
    listProjects({ page: 1, pageSize: 300 }),
    listWarehouses()
  ]);
  assetTypes.value = typeRes.data;
  projects.value = projectRes.data;
  warehouses.value = warehouseRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listTrackedAssets({
      page: page.value,
      pageSize: pageSize.value,
      asset_type_id: filters.value.asset_type_id,
      status: filters.value.status || undefined,
      project_id: filters.value.project_id,
      warehouse_id: filters.value.warehouse_id,
      ownership_type: filters.value.ownership_type || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    asset_type_id: undefined,
    asset_name: "",
    brand: "",
    model: "",
    serial_no: "",
    current_project_id: undefined,
    current_warehouse_id: undefined,
    current_location: "",
    purchased_date: "",
    properties_json: '{"spec":""}',
    ownership_type: "owned"
  };
  createDialogVisible.value = true;
};

const submitCreate = async () => {
  if (!form.value.asset_type_id || !form.value.asset_name.trim()) {
    message("请填写资产类型和资产名称", { type: "warning" });
    return;
  }

  creating.value = true;
  try {
    const result = await createTrackedAsset({
      asset_type_id: form.value.asset_type_id,
      asset_name: form.value.asset_name,
      brand: form.value.brand || undefined,
      model: form.value.model || undefined,
      serial_no: form.value.serial_no || undefined,
      current_project_id: form.value.current_project_id,
      current_warehouse_id: form.value.current_warehouse_id,
      current_location: form.value.current_location || undefined,
      purchased_date: form.value.purchased_date || undefined,
      properties_json: form.value.properties_json || undefined,
      ownership_type: form.value.ownership_type
    });
    message(`创建成功：${result.data.asset_code}`, { type: "success" });
    createDialogVisible.value = false;
    await loadData();
  } finally {
    creating.value = false;
  }
};

const goDetail = (id: number) => {
  router.push(`/warehouse-assets/device/${id}`);
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
        <span>资产台账</span>
        <el-button type="primary" @click="openCreate">新增资产</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="资产类型">
        <el-select
          v-model="filters.asset_type_id"
          clearable
          style="width: 180px"
        >
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="item.type_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 140px">
          <el-option label="idle" value="idle" />
          <el-option label="using" value="using" />
          <el-option label="repair" value="repair" />
          <el-option label="scrapped" value="scrapped" />
        </el-select>
      </el-form-item>
      <el-form-item label="项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 180px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
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
      <el-form-item label="归属">
        <el-select
          v-model="filters.ownership_type"
          clearable
          style="width: 160px"
        >
          <el-option label="自有" value="owned" />
          <el-option label="租入" value="leased_in" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编码/名称/序列号"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column label="资产编码" width="170">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)">
            {{ scope.row.asset_code }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="140">
        <template #default="scope">{{
          typeMap[scope.row.asset_type_id] || scope.row.asset_type_id
        }}</template>
      </el-table-column>
      <el-table-column label="资产名称" width="160">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)">
            {{ scope.row.asset_name }}
          </el-button>
        </template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="120" />
      <el-table-column prop="model" label="型号" width="120" />
      <el-table-column label="状态" width="100">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="归属" width="100">
        <template #default="scope">
          <el-tag
            :type="
              scope.row.ownership_type === 'leased_in' ? 'warning' : 'success'
            "
            size="small"
          >
            {{ scope.row.ownership_type === "leased_in" ? "租入" : "自有" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前项目" width="160">
        <template #default="scope">{{
          scope.row.current_project_id
            ? projectMap[scope.row.current_project_id]
            : "-"
        }}</template>
      </el-table-column>
      <el-table-column label="当前仓库" width="160">
        <template #default="scope">{{
          scope.row.current_warehouse_id
            ? warehouseMap[scope.row.current_warehouse_id]
            : "-"
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>

  <el-dialog v-model="createDialogVisible" title="新增资产" width="640px">
    <el-form label-width="120px">
      <el-form-item label="资产类型" required>
        <el-select v-model="form.asset_type_id" filterable style="width: 100%">
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="item.type_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="资产名称" required>
        <el-input v-model="form.asset_name" />
      </el-form-item>
      <el-form-item label="品牌/型号">
        <el-input
          v-model="form.brand"
          placeholder="品牌"
          style="width: 48%; margin-right: 4%"
        />
        <el-input v-model="form.model" placeholder="型号" style="width: 48%" />
      </el-form-item>
      <el-form-item label="序列号">
        <el-input v-model="form.serial_no" />
      </el-form-item>
      <el-form-item label="项目/仓库">
        <el-select
          v-model="form.current_project_id"
          clearable
          filterable
          style="width: 48%; margin-right: 4%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="form.current_warehouse_id"
          clearable
          filterable
          style="width: 48%"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="当前位置">
        <el-input v-model="form.current_location" />
      </el-form-item>
      <el-form-item label="采购日期">
        <el-date-picker
          v-model="form.purchased_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="资产归属">
        <el-select v-model="form.ownership_type" style="width: 220px">
          <el-option label="自有" value="owned" />
          <el-option label="租入" value="leased_in" />
        </el-select>
      </el-form-item>
      <el-form-item label="属性JSON">
        <el-input v-model="form.properties_json" type="textarea" :rows="4" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate"
        >创建</el-button
      >
    </template>
  </el-dialog>
</template>
