<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  createDictItem,
  deleteDictItem,
  listDictItems,
  type DictItem
} from "@/api/dict";

defineOptions({
  name: "DictManagement"
});

const dictType = ref("");
const dictRows = ref<DictItem[]>([]);
const form = ref({
  dict_type: "",
  dict_label: "",
  dict_value: "",
  sort_order: 10,
  status: "active"
});

const loadRows = async () => {
  const result = await listDictItems(dictType.value || undefined);
  if (Array.isArray(result.data)) {
    dictRows.value = result.data;
  } else {
    dictRows.value = Object.values(result.data).flat();
  }
};

const createRow = async () => {
  if (
    !form.value.dict_type ||
    !form.value.dict_label ||
    !form.value.dict_value
  ) {
    message("请填写字典类型/标签/值", { type: "warning" });
    return;
  }

  await createDictItem({ ...form.value });
  form.value = {
    dict_type: form.value.dict_type,
    dict_label: "",
    dict_value: "",
    sort_order: 10,
    status: "active"
  };
  await loadRows();
  message("字典项创建成功", { type: "success" });
};

const removeRow = async (id: number) => {
  await deleteDictItem(id);
  await loadRows();
  message("删除成功", { type: "success" });
};

onMounted(loadRows);
</script>

<template>
  <el-card shadow="never" header="数据字典管理">
    <el-form inline>
      <el-form-item label="筛选类型">
        <el-input v-model="dictType" placeholder="如 payment_method" />
      </el-form-item>
      <el-button @click="loadRows">查询</el-button>
    </el-form>

    <el-divider />

    <el-form inline>
      <el-form-item label="类型">
        <el-input v-model="form.dict_type" />
      </el-form-item>
      <el-form-item label="标签">
        <el-input v-model="form.dict_label" />
      </el-form-item>
      <el-form-item label="值">
        <el-input v-model="form.dict_value" />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="form.sort_order" :min="0" />
      </el-form-item>
      <el-button type="primary" @click="createRow">新增</el-button>
    </el-form>

    <el-table :data="dictRows" style="margin-top: 12px">
      <el-table-column prop="dict_type" label="类型" width="160" />
      <el-table-column prop="dict_label" label="标签" width="180" />
      <el-table-column prop="dict_value" label="值" width="180" />
      <el-table-column prop="sort_order" label="排序" width="90" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="scope">
          <el-button link type="danger" @click="removeRow(scope.row.id)">
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
