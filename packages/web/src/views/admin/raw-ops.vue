<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listEntities,
  createEntity,
  updateEntity,
  type Entity
} from "@/api/entity";
import {
  listDictItems,
  createDictItem,
  updateDictItem,
  deleteDictItem,
  type DictItem
} from "@/api/dict";
import {
  getWeComContacts,
  type WeComDepartment,
  type WeComUser
} from "@/api/wecom";

type OpsNode = {
  id: "entity" | "dict" | "wecom_user" | "wecom_dept";
  label: string;
};

const loading = ref(false);
const activeNode = ref<OpsNode["id"]>("entity");

const entities = ref<Entity[]>([]);
const dictItems = ref<DictItem[]>([]);
const wecomUsers = ref<WeComUser[]>([]);
const wecomDepartments = ref<WeComDepartment[]>([]);

const editDrawerVisible = ref(false);
const editMode = ref<"create" | "edit">("create");
const editKind = ref<"entity" | "dict">("entity");
const editId = ref<number | null>(null);
const submitting = ref(false);

const entityForm = ref({
  entity_code: "",
  entity_name: "",
  legal_person: "",
  status: "active"
});

const dictForm = ref({
  dict_type: "",
  dict_label: "",
  dict_value: "",
  sort_order: 0,
  status: "active"
});

const nodes: OpsNode[] = [
  { id: "entity", label: "经营实体" },
  { id: "dict", label: "基础字典" },
  { id: "wecom_user", label: "企微成员" },
  { id: "wecom_dept", label: "企微部门" }
];

const tableRows = computed<Array<Record<string, unknown>>>(() => {
  if (activeNode.value === "entity") return entities.value;
  if (activeNode.value === "dict") return dictItems.value;
  if (activeNode.value === "wecom_user") return wecomUsers.value;
  return wecomDepartments.value;
});

const tableColumns = computed<
  Array<{ key: string; label: string; width?: number }>
>(() => {
  if (activeNode.value === "entity") {
    return [
      { key: "id", label: "ID", width: 80 },
      { key: "entity_code", label: "实体编码", width: 140 },
      { key: "entity_name", label: "实体名称", width: 180 },
      { key: "legal_person", label: "法人", width: 120 },
      { key: "status", label: "状态", width: 100 },
      { key: "updated_at", label: "更新时间", width: 180 }
    ];
  }
  if (activeNode.value === "dict") {
    return [
      { key: "id", label: "ID", width: 80 },
      { key: "dict_type", label: "字典类型", width: 160 },
      { key: "dict_label", label: "标签", width: 180 },
      { key: "dict_value", label: "值", width: 180 },
      { key: "sort_order", label: "排序", width: 90 },
      { key: "status", label: "状态", width: 100 }
    ];
  }
  if (activeNode.value === "wecom_user") {
    return [
      { key: "userid", label: "userid", width: 220 },
      { key: "name", label: "姓名", width: 140 },
      { key: "mobile", label: "手机号", width: 140 },
      { key: "email", label: "邮箱", width: 200 }
    ];
  }
  return [
    { key: "id", label: "部门ID", width: 100 },
    { key: "name", label: "部门名称", width: 180 },
    { key: "parentid", label: "上级部门", width: 100 },
    { key: "order", label: "排序", width: 100 }
  ];
});

const loadData = async () => {
  loading.value = true;
  try {
    const [entityRes, dictRes, wecomRes] = await Promise.all([
      listEntities(),
      listDictItems(),
      getWeComContacts()
    ]);
    entities.value = entityRes.data;
    dictItems.value = Array.isArray(dictRes.data)
      ? dictRes.data
      : Object.values(dictRes.data).flat();
    wecomUsers.value = wecomRes.data.users;
    wecomDepartments.value = wecomRes.data.departments;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  if (!["entity", "dict"].includes(activeNode.value)) {
    message("当前数据域不支持前端直改", { type: "warning" });
    return;
  }
  editMode.value = "create";
  editKind.value = activeNode.value as "entity" | "dict";
  editId.value = null;
  entityForm.value = {
    entity_code: "",
    entity_name: "",
    legal_person: "",
    status: "active"
  };
  dictForm.value = {
    dict_type: "",
    dict_label: "",
    dict_value: "",
    sort_order: 0,
    status: "active"
  };
  editDrawerVisible.value = true;
};

const openEdit = (row: Record<string, unknown>) => {
  if (activeNode.value === "entity") {
    const target = row as unknown as Entity;
    editMode.value = "edit";
    editKind.value = "entity";
    editId.value = target.id;
    entityForm.value = {
      entity_code: target.entity_code,
      entity_name: target.entity_name,
      legal_person: target.legal_person || "",
      status: target.status
    };
    editDrawerVisible.value = true;
    return;
  }
  if (activeNode.value === "dict") {
    const target = row as unknown as DictItem;
    editMode.value = "edit";
    editKind.value = "dict";
    editId.value = target.id;
    dictForm.value = {
      dict_type: target.dict_type,
      dict_label: target.dict_label,
      dict_value: target.dict_value,
      sort_order: target.sort_order,
      status: target.status
    };
    editDrawerVisible.value = true;
  }
};

const save = async () => {
  submitting.value = true;
  try {
    if (editKind.value === "entity") {
      if (
        !entityForm.value.entity_code.trim() ||
        !entityForm.value.entity_name.trim()
      ) {
        message("请填写实体编码与名称", { type: "warning" });
        return;
      }
      if (editMode.value === "create") {
        await createEntity({
          entity_code: entityForm.value.entity_code.trim(),
          entity_name: entityForm.value.entity_name.trim(),
          legal_person: entityForm.value.legal_person.trim() || undefined
        });
      } else if (editId.value) {
        await updateEntity(editId.value, {
          entity_name: entityForm.value.entity_name.trim(),
          legal_person: entityForm.value.legal_person.trim() || null,
          status: entityForm.value.status
        });
      }
    } else {
      if (
        !dictForm.value.dict_type.trim() ||
        !dictForm.value.dict_label.trim()
      ) {
        message("请填写字典类型与标签", { type: "warning" });
        return;
      }
      if (editMode.value === "create") {
        await createDictItem({
          dict_type: dictForm.value.dict_type.trim(),
          dict_label: dictForm.value.dict_label.trim(),
          dict_value: dictForm.value.dict_value.trim(),
          sort_order: dictForm.value.sort_order,
          status: dictForm.value.status
        });
      } else if (editId.value) {
        await updateDictItem(editId.value, {
          dict_label: dictForm.value.dict_label.trim(),
          dict_value: dictForm.value.dict_value.trim(),
          sort_order: dictForm.value.sort_order,
          status: dictForm.value.status
        });
      }
    }

    message("保存成功", { type: "success" });
    editDrawerVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const remove = async (row: Record<string, unknown>) => {
  if (activeNode.value === "entity") {
    const target = row as unknown as Entity;
    await updateEntity(target.id, { status: "inactive" });
    message("实体已停用", { type: "success" });
    await loadData();
    return;
  }
  if (activeNode.value === "dict") {
    const target = row as unknown as DictItem;
    await deleteDictItem(target.id);
    message("字典项已删除", { type: "success" });
    await loadData();
  }
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" class="raw-ops">
    <el-alert
      title="高风险操作区域：请先核验实体、字典与企微映射后再执行后端维护操作"
      type="error"
      :closable="false"
      show-icon
      class="mb-3"
    />

    <div v-loading="loading" class="layout">
      <div class="left-tree">
        <div class="left-tree__title">数据域</div>
        <el-menu
          :default-active="activeNode"
          @select="(key: string) => (activeNode = key as OpsNode['id'])"
        >
          <el-menu-item v-for="item in nodes" :key="item.id" :index="item.id">
            {{ item.label }}
          </el-menu-item>
        </el-menu>
      </div>

      <div class="right-table">
        <div class="right-table__head">
          <div class="title">
            {{ nodes.find(item => item.id === activeNode)?.label }}
          </div>
          <div style="display: flex; gap: 8px">
            <el-button @click="loadData">刷新</el-button>
            <el-button
              v-if="activeNode === 'entity' || activeNode === 'dict'"
              type="primary"
              @click="openCreate"
            >
              新增
            </el-button>
          </div>
        </div>

        <el-table :data="tableRows" stripe size="small">
          <el-table-column
            v-for="col in tableColumns"
            :key="col.key"
            :prop="col.key"
            :label="col.label"
            :width="col.width"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            v-if="activeNode === 'entity' || activeNode === 'dict'"
            label="操作"
            width="140"
            fixed="right"
          >
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)"
                >编辑</el-button
              >
              <el-popconfirm
                title="确认执行删除/停用？"
                @confirm="remove(scope.row)"
              >
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </el-card>

  <el-drawer
    v-model="editDrawerVisible"
    :title="editMode === 'create' ? '新增记录' : '编辑记录'"
    size="520px"
    destroy-on-close
  >
    <el-form v-if="editKind === 'entity'" label-width="100px">
      <el-form-item label="实体编码" required>
        <el-input
          v-model="entityForm.entity_code"
          :disabled="editMode === 'edit'"
        />
      </el-form-item>
      <el-form-item label="实体名称" required>
        <el-input v-model="entityForm.entity_name" />
      </el-form-item>
      <el-form-item label="法人">
        <el-input v-model="entityForm.legal_person" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="entityForm.status" style="width: 100%">
          <el-option label="active" value="active" />
          <el-option label="inactive" value="inactive" />
        </el-select>
      </el-form-item>
    </el-form>

    <el-form v-else label-width="100px">
      <el-form-item label="字典类型" required>
        <el-input
          v-model="dictForm.dict_type"
          :disabled="editMode === 'edit'"
        />
      </el-form-item>
      <el-form-item label="字典标签" required>
        <el-input v-model="dictForm.dict_label" />
      </el-form-item>
      <el-form-item label="字典值">
        <el-input v-model="dictForm.dict_value" />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="dictForm.sort_order" :min="0" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="dictForm.status" style="width: 100%">
          <el-option label="active" value="active" />
          <el-option label="inactive" value="inactive" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="editDrawerVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="save"
        >保存</el-button
      >
    </template>
  </el-drawer>
</template>

<style scoped>
.raw-ops {
  background: #fffaf2;
}

.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
}

.left-tree,
.right-table {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
}

.left-tree__title,
.right-table__head {
  padding: 10px;
  border-bottom: 1px solid #e8ddc8;
}

.right-table__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-weight: 700;
  color: #2a241d;
}

.mb-3 {
  margin-bottom: 12px;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
