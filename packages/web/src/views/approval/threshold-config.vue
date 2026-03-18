<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { message } from "@/utils/message";
import {
  listApprovalTemplates,
  listThresholds,
  createThreshold,
  updateThreshold,
  deleteThreshold,
  type ApprovalTemplate,
  type ApprovalThreshold
} from "@/api/admin";
import { toStatusLabel } from "./labels";

defineOptions({ name: "ApprovalThresholdConfig" });

const loading = ref(false);
const saving = ref(false);
const templates = ref<ApprovalTemplate[]>([]);
const selectedTemplateId = ref<number | undefined>(undefined);
const thresholds = ref<ApprovalThreshold[]>([]);

const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);
const form = ref({
  condition_field: "amount",
  operator: "gt",
  threshold_value: 0,
  threshold_value_upper: undefined as number | undefined,
  target_branch: "",
  priority: 0
});

const operatorOptions = [
  { label: "大于 (gt)", value: "gt" },
  { label: "大于等于 (gte)", value: "gte" },
  { label: "小于 (lt)", value: "lt" },
  { label: "小于等于 (lte)", value: "lte" },
  { label: "等于 (eq)", value: "eq" },
  { label: "介于 (between)", value: "between" }
];

const loadTemplates = async () => {
  const result = await listApprovalTemplates();
  templates.value = result.data;
};

const loadThresholds = async () => {
  if (!selectedTemplateId.value) {
    thresholds.value = [];
    return;
  }
  loading.value = true;
  try {
    const result = await listThresholds({
      template_id: selectedTemplateId.value
    });
    thresholds.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  dialogMode.value = "create";
  editingId.value = null;
  form.value = {
    condition_field: "amount",
    operator: "gt",
    threshold_value: 0,
    threshold_value_upper: undefined,
    target_branch: "",
    priority: 0
  };
  dialogVisible.value = true;
};

const openEdit = (row: ApprovalThreshold) => {
  dialogMode.value = "edit";
  editingId.value = row.id;
  form.value = {
    condition_field: row.condition_field,
    operator: row.operator,
    threshold_value: row.threshold_value,
    threshold_value_upper: row.threshold_value_upper ?? undefined,
    target_branch: row.target_branch,
    priority: row.priority
  };
  dialogVisible.value = true;
};

const handleSave = async () => {
  if (!form.value.target_branch) {
    message("请填写目标分支", { type: "warning" });
    return;
  }
  try {
    saving.value = true;
    if (dialogMode.value === "create" && selectedTemplateId.value) {
      await createThreshold({
        template_id: selectedTemplateId.value,
        condition_field: form.value.condition_field,
        operator: form.value.operator,
        threshold_value: form.value.threshold_value,
        threshold_value_upper:
          form.value.operator === "between"
            ? form.value.threshold_value_upper
            : undefined,
        target_branch: form.value.target_branch,
        priority: form.value.priority
      });
      message("创建成功", { type: "success" });
    } else if (editingId.value) {
      await updateThreshold(editingId.value, {
        condition_field: form.value.condition_field,
        operator: form.value.operator,
        threshold_value: form.value.threshold_value,
        threshold_value_upper:
          form.value.operator === "between"
            ? form.value.threshold_value_upper
            : null,
        target_branch: form.value.target_branch,
        priority: form.value.priority
      });
      message("更新成功", { type: "success" });
    }
    dialogVisible.value = false;
    await loadThresholds();
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const handleDelete = async (row: ApprovalThreshold) => {
  try {
    await deleteThreshold(row.id);
    message("已删除", { type: "success" });
    await loadThresholds();
  } catch {
    message("删除失败", { type: "error" });
  }
};

watch(selectedTemplateId, loadThresholds);

onMounted(loadTemplates);
</script>

<template>
  <el-card shadow="never" header="金额阈值配置">
    <el-form inline style="margin-bottom: 12px">
      <el-form-item label="选择模板">
        <el-select
          v-model="selectedTemplateId"
          clearable
          placeholder="请选择模板"
          style="width: 280px"
        >
          <el-option
            v-for="t in templates"
            :key="t.id"
            :label="`${t.template_name} (${t.template_code})`"
            :value="t.id"
          />
        </el-select>
      </el-form-item>
      <el-button
        type="primary"
        :disabled="!selectedTemplateId"
        @click="openCreate"
        >新增阈值</el-button
      >
    </el-form>

    <el-table v-loading="loading" :data="thresholds" style="width: 100%">
      <el-table-column prop="condition_field" label="条件字段" width="120" />
      <el-table-column prop="operator" label="运算符" width="100" />
      <el-table-column prop="threshold_value" label="阈值" width="120" />
      <el-table-column label="上限值" width="120">
        <template #default="{ row }">
          {{ row.operator === "between" ? row.threshold_value_upper : "—" }}
        </template>
      </el-table-column>
      <el-table-column prop="target_branch" label="目标分支" min-width="140" />
      <el-table-column prop="priority" label="优先级" width="80" />
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'active' ? 'success' : 'info'"
            size="small"
          >
            {{ toStatusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确定删除？" @confirm="handleDelete(row)">
            <template #reference>
              <el-button link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog
    v-model="dialogVisible"
    :title="dialogMode === 'create' ? '新增阈值' : '编辑阈值'"
    width="520px"
  >
    <el-form label-width="90px">
      <el-form-item label="条件字段">
        <el-input v-model="form.condition_field" placeholder="如: amount" />
      </el-form-item>
      <el-form-item label="运算符">
        <el-select v-model="form.operator">
          <el-option
            v-for="op in operatorOptions"
            :key="op.value"
            :label="op.label"
            :value="op.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="阈值">
        <el-input-number v-model="form.threshold_value" :min="0" />
      </el-form-item>
      <el-form-item v-if="form.operator === 'between'" label="上限值">
        <el-input-number v-model="form.threshold_value_upper" :min="0" />
      </el-form-item>
      <el-form-item label="目标分支">
        <el-input v-model="form.target_branch" placeholder="模板中的分支key" />
      </el-form-item>
      <el-form-item label="优先级">
        <el-input-number v-model="form.priority" :min="0" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>
