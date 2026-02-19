<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  createPayee,
  deletePayee,
  listPayees,
  updatePayee,
  type Payee
} from "@/api/payment";

defineOptions({ name: "PayeeList" });

const activeTab = ref<"external" | "internal">("external");
const loading = ref(false);
const list = ref<Payee[]>([]);
const keyword = ref("");

const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);

const form = ref({
  name: "",
  bank_name: "",
  bank_account: "",
  phone: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listPayees({
      type: activeTab.value,
      keyword: keyword.value || undefined
    });
    list.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  dialogMode.value = "create";
  editingId.value = null;
  form.value = { name: "", bank_name: "", bank_account: "", phone: "" };
  dialogVisible.value = true;
};

const openEdit = (row: Payee) => {
  dialogMode.value = "edit";
  editingId.value = row.id;
  form.value = {
    name: row.name,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    phone: row.phone ?? ""
  };
  dialogVisible.value = true;
};

const onSave = async () => {
  if (!form.value.name || !form.value.bank_name || !form.value.bank_account) {
    message("请填写完整信息", { type: "warning" });
    return;
  }

  if (dialogMode.value === "create") {
    await createPayee({
      name: form.value.name,
      bank_name: form.value.bank_name,
      bank_account: form.value.bank_account,
      phone: form.value.phone || undefined,
      type: activeTab.value
    });
    message("创建成功", { type: "success" });
  } else if (editingId.value) {
    await updatePayee(editingId.value, {
      name: form.value.name,
      bank_name: form.value.bank_name,
      bank_account: form.value.bank_account,
      phone: form.value.phone || undefined,
      type: activeTab.value
    });
    message("更新成功", { type: "success" });
  }

  dialogVisible.value = false;
  await loadData();
};

const onDelete = async (row: Payee) => {
  try {
    await ElMessageBox.confirm(`确认删除收款人 ${row.name} 吗？`, "提示", {
      type: "warning"
    });
    await deletePayee(row.id);
    message("删除成功", { type: "success" });
    await loadData();
  } catch {
    // cancelled
  }
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <el-tabs v-model="activeTab" @tab-change="() => loadData()">
      <el-tab-pane label="外部收款人" name="external" />
      <el-tab-pane label="内部收款人" name="internal" />
    </el-tabs>

    <el-form inline>
      <el-form-item label="关键字">
        <el-input v-model="keyword" placeholder="名称/账号" clearable />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
      <el-button @click="openCreate">新增收款人</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="name" label="名称" min-width="180" />
      <el-table-column prop="bank_name" label="开户行" min-width="180" />
      <el-table-column prop="bank_account" label="账号" min-width="220" />
      <el-table-column prop="phone" label="电话" width="130" />
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="160" fixed="right">
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

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增收款人' : '编辑收款人'"
      width="560px"
    >
      <el-form label-width="88px">
        <el-form-item label="名称"
          ><el-input v-model="form.name"
        /></el-form-item>
        <el-form-item label="开户行"
          ><el-input v-model="form.bank_name"
        /></el-form-item>
        <el-form-item label="账号"
          ><el-input v-model="form.bank_account"
        /></el-form-item>
        <el-form-item label="电话"
          ><el-input v-model="form.phone"
        /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
