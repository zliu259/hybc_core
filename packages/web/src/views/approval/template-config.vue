<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listApprovalTemplates,
  createApprovalTemplate,
  updateApprovalTemplate,
  deleteApprovalTemplate,
  bootstrapInitialApprovalConfig,
  type ApprovalTemplate
} from "@/api/admin";
import ApprovalFlowDesigner from "@/components/ApprovalFlowDesigner/index.vue";
import { toBizTypeLabel, toStatusLabel } from "./labels";

defineOptions({ name: "ApprovalTemplateConfig" });

const loading = ref(false);
const templates = ref<ApprovalTemplate[]>([]);

const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const editingId = ref<number | null>(null);
const form = ref({
  template_code: "",
  template_name: "",
  biz_type: "",
  config_json: ""
});

const previewVisible = ref(false);
const previewConfig = ref("");

const bizTypeOptions = [
  { label: "对外合同审批", value: "outbound_contract" },
  { label: "收款合同审批", value: "inbound_contract" },
  { label: "付款申请审批", value: "payment_request" },
  { label: "报销批次审批", value: "reimbursement_batch" },
  { label: "出入库审批", value: "stock_order" },
  { label: "合同金额变更", value: "contract_amount_change" }
];

const bootstrapLoading = ref(false);

const handleBootstrapInitialConfig = async () => {
  bootstrapLoading.value = true;
  try {
    const result = await bootstrapInitialApprovalConfig();
    message(
      `初始化完成：模板 ${result.data.templates_active}，阈值 ${result.data.thresholds_active}`,
      { type: "success" }
    );
    await loadTemplates();
  } catch {
    message("初始化失败", { type: "error" });
  } finally {
    bootstrapLoading.value = false;
  }
};

const loadTemplates = async () => {
  loading.value = true;
  try {
    const result = await listApprovalTemplates();
    templates.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  dialogMode.value = "create";
  editingId.value = null;
  form.value = {
    template_code: "",
    template_name: "",
    biz_type: "",
    config_json: ""
  };
  dialogVisible.value = true;
};

const openEdit = (row: ApprovalTemplate) => {
  dialogMode.value = "edit";
  editingId.value = row.id;
  form.value = {
    template_code: row.template_code,
    template_name: row.template_name,
    biz_type: row.biz_type,
    config_json: row.config_json
  };
  dialogVisible.value = true;
};

const openPreview = (row: ApprovalTemplate) => {
  previewConfig.value = row.config_json;
  previewVisible.value = true;
};

const handleSave = async () => {
  if (
    !form.value.template_code ||
    !form.value.template_name ||
    !form.value.biz_type
  ) {
    message("请填写完整信息", { type: "warning" });
    return;
  }
  try {
    if (dialogMode.value === "create") {
      await createApprovalTemplate({ ...form.value });
      message("模板创建成功", { type: "success" });
    } else if (editingId.value) {
      await updateApprovalTemplate(editingId.value, {
        template_name: form.value.template_name,
        biz_type: form.value.biz_type,
        config_json: form.value.config_json
      });
      message("模板更新成功", { type: "success" });
    }
    dialogVisible.value = false;
    await loadTemplates();
  } catch {
    message("保存失败", { type: "error" });
  }
};

const handleDelete = async (row: ApprovalTemplate) => {
  try {
    await deleteApprovalTemplate(row.id);
    message("已删除", { type: "success" });
    await loadTemplates();
  } catch {
    message("删除失败", { type: "error" });
  }
};

onMounted(loadTemplates);
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>审批模板配置</span>
        <el-space>
          <el-button
            :loading="bootstrapLoading"
            type="warning"
            @click="handleBootstrapInitialConfig"
          >
            初始化默认流程
          </el-button>
          <el-button type="primary" @click="openCreate">新建模板</el-button>
        </el-space>
      </div>
    </template>

    <el-table v-loading="loading" :data="templates" style="width: 100%">
      <el-table-column prop="template_code" label="模板编码" width="160" />
      <el-table-column prop="template_name" label="模板名称" min-width="180" />
      <el-table-column label="业务类型" width="140">
        <template #default="{ row }">{{ toBizTypeLabel(row.biz_type) }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'active' ? 'success' : 'info'"
            size="small"
          >
            {{ toStatusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="openPreview(row)"
            >预览</el-button
          >
          <el-popconfirm title="确定删除此模板？" @confirm="handleDelete(row)">
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
    :title="dialogMode === 'create' ? '新建模板' : '编辑模板'"
    width="90%"
    top="3vh"
  >
    <el-form label-width="90px" style="margin-bottom: 16px">
      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item label="模板编码">
            <el-input
              v-model="form.template_code"
              :disabled="dialogMode === 'edit'"
            />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="模板名称">
            <el-input v-model="form.template_name" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="业务类型">
            <el-select v-model="form.biz_type">
              <el-option
                v-for="opt in bizTypeOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>
    <ApprovalFlowDesigner v-model:config="form.config_json" />
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="previewVisible" title="流程预览" width="80%" top="5vh">
    <ApprovalFlowDesigner :config="previewConfig" readonly />
  </el-dialog>
</template>
