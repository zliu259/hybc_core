<script setup lang="ts">
import { reactive, ref } from "vue";
import { message } from "@/utils/message";

type TemplateItem = {
  id: number;
  name: string;
  equipment: string;
  materials: string;
  remark: string;
};

const drawerVisible = ref(false);
const editId = ref<number | null>(null);
const rows = ref<TemplateItem[]>([
  {
    id: 1,
    name: "标准顶管掘进组",
    equipment: "主机1套, 泥浆泵2台",
    materials: "刀盘耗材20件, 连接件50件",
    remark: "默认模板"
  }
]);

const form = reactive<TemplateItem>({
  id: 0,
  name: "",
  equipment: "",
  materials: "",
  remark: ""
});

const openCreate = () => {
  editId.value = null;
  form.id = 0;
  form.name = "";
  form.equipment = "";
  form.materials = "";
  form.remark = "";
  drawerVisible.value = true;
};

const openEdit = (row: TemplateItem) => {
  editId.value = row.id;
  form.id = row.id;
  form.name = row.name;
  form.equipment = row.equipment;
  form.materials = row.materials;
  form.remark = row.remark;
  drawerVisible.value = true;
};

const removeRow = (id: number) => {
  rows.value = rows.value.filter(item => item.id !== id);
  message("模板已删除", { type: "success" });
};

const save = () => {
  if (!form.name.trim()) {
    message("请填写模板名称", { type: "warning" });
    return;
  }
  const payload: TemplateItem = {
    id: form.id || Date.now(),
    name: form.name.trim(),
    equipment: form.equipment.trim(),
    materials: form.materials.trim(),
    remark: form.remark.trim()
  };
  if (editId.value) {
    rows.value = rows.value.map(item =>
      item.id === payload.id ? payload : item
    );
  } else {
    rows.value.unshift(payload);
  }
  drawerVisible.value = false;
  message("模板已保存", { type: "success" });
};
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div class="head">
        <div>
          <div class="title">搭配模板管理</div>
          <div class="sub">使用抽屉维护常用设备与材料组合</div>
        </div>
        <el-button type="primary" @click="openCreate">新建模板</el-button>
      </div>
    </template>

    <el-table :data="rows" stripe size="small">
      <el-table-column prop="name" label="模板名称" min-width="180" />
      <el-table-column prop="equipment" label="设备组合" min-width="240" />
      <el-table-column prop="materials" label="材料组合" min-width="240" />
      <el-table-column prop="remark" label="备注" min-width="160" />
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确认删除该模板？" @confirm="removeRow(row.id)">
            <template #reference>
              <el-button link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="drawerVisible"
    title="模板维护"
    size="520px"
    destroy-on-close
  >
    <el-form label-width="100px">
      <el-form-item label="模板名称" required>
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item label="设备组合">
        <el-input v-model="form.equipment" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="材料组合">
        <el-input v-model="form.materials" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="drawerVisible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
</style>
