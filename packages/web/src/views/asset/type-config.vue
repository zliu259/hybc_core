<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  createAssetType,
  deleteAssetType,
  listAssetTypes,
  type AssetType
} from "@/api/asset";

defineOptions({ name: "AssetTypeConfig" });

const loading = ref(false);
const list = ref<AssetType[]>([]);

const createDialogVisible = ref(false);
const creating = ref(false);
const form = ref({
  type_code: "",
  type_name: "",
  tracked_flag: 0,
  unit: "件",
  min_stock: undefined as number | undefined,
  property_schema: '{"fields":[{"key":"spec","label":"规格","type":"string"}]}'
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listAssetTypes();
    list.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  form.value = {
    type_code: "",
    type_name: "",
    tracked_flag: 0,
    unit: "件",
    min_stock: undefined,
    property_schema:
      '{"fields":[{"key":"spec","label":"规格","type":"string"}]}'
  };
  createDialogVisible.value = true;
};

const submitCreate = async () => {
  creating.value = true;
  try {
    await createAssetType({
      type_code: form.value.type_code,
      type_name: form.value.type_name,
      tracked_flag: form.value.tracked_flag,
      unit: form.value.unit,
      min_stock: form.value.min_stock,
      property_schema: form.value.property_schema
    });
    message("资产类型创建成功", { type: "success" });
    createDialogVisible.value = false;
    await loadData();
  } finally {
    creating.value = false;
  }
};

const onDelete = async (row: AssetType) => {
  await deleteAssetType(row.id);
  message("删除成功", { type: "success" });
  await loadData();
};

onMounted(loadData);
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
        <span>资产类型管理</span>
        <el-button type="primary" @click="openCreate">新增类型</el-button>
      </div>
    </template>

    <el-table :data="list" :loading="loading">
      <el-table-column prop="type_code" label="类型编码" width="140" />
      <el-table-column prop="type_name" label="类型名称" width="160" />
      <el-table-column label="有状态" width="100">
        <template #default="scope">{{
          scope.row.tracked_flag ? "是" : "否"
        }}</template>
      </el-table-column>
      <el-table-column prop="unit" label="单位" width="90" />
      <el-table-column prop="min_stock" label="安全库存" width="110" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column
        prop="property_schema"
        label="属性模板(JSON)"
        min-width="300"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="danger" @click="onDelete(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="createDialogVisible" title="新增资产类型" width="620px">
    <el-form label-width="110px">
      <el-form-item label="类型编码" required>
        <el-input v-model="form.type_code" placeholder="例如 MACH" />
      </el-form-item>
      <el-form-item label="类型名称" required>
        <el-input v-model="form.type_name" placeholder="例如 机械设备" />
      </el-form-item>
      <el-form-item label="有状态资产">
        <el-switch
          v-model="form.tracked_flag"
          :active-value="1"
          :inactive-value="0"
        />
      </el-form-item>
      <el-form-item label="单位">
        <el-input v-model="form.unit" style="width: 160px" />
      </el-form-item>
      <el-form-item label="安全库存">
        <el-input-number v-model="form.min_stock" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="属性模板JSON">
        <el-input v-model="form.property_schema" type="textarea" :rows="5" />
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
