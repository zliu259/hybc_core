<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  listAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  listAiRoutingRules,
  createAiRoutingRule,
  updateAiRoutingRule,
  deleteAiRoutingRule,
  listAiPromptTemplates,
  createAiPromptTemplate,
  updateAiPromptTemplate,
  deleteAiPromptTemplate,
  bootstrapNearProductionOpenAIConfig,
  type AiProviderConfig,
  type AiRoutingRule,
  type AiPromptTemplate
} from "@/api/admin";

defineOptions({ name: "AiConfig" });

const activeTab = ref("providers");

const providers = ref<AiProviderConfig[]>([]);
const providersLoading = ref(false);
const providerDialogVisible = ref(false);
const providerDialogMode = ref<"create" | "edit">("create");
const providerEditingId = ref<number | null>(null);
const providerForm = ref({
  provider_key: "",
  provider_name: "",
  api_endpoint: "",
  model_id: "",
  config_json: "",
  priority: 0,
  max_concurrent: 1
});

const rules = ref<AiRoutingRule[]>([]);
const rulesLoading = ref(false);
const ruleDialogVisible = ref(false);
const ruleDialogMode = ref<"create" | "edit">("create");
const ruleEditingId = ref<number | null>(null);
const ruleForm = ref({
  rule_name: "",
  biz_type: "",
  task_type: "",
  condition_json: "",
  provider_id: undefined as number | undefined,
  prompt_template_id: undefined as number | undefined,
  priority: 0
});

const prompts = ref<AiPromptTemplate[]>([]);
const promptsLoading = ref(false);
const promptDialogVisible = ref(false);
const promptDialogMode = ref<"create" | "edit">("create");
const promptEditingId = ref<number | null>(null);
const promptForm = ref({
  template_key: "",
  template_name: "",
  system_prompt: "",
  user_prompt_template: "",
  variables_schema: ""
});

const taskTypeOptions = [
  "contract_review",
  "payment_risk_assessment",
  "risk_assessment",
  "reimbursement_check",
  "reimbursement_anomaly",
  "log_smart_fill",
  "log_analysis",
  "log_summary",
  "equipment_recommend",
  "consumable_estimation",
  "inventory_alert_analysis",
  "consumption_anomaly",
  "ocr_extract",
  "file_generate",
  "voice_stt",
  "approval_ai_gate"
];

const bizTypeOptions = [
  { label: "合同审批", value: "contract_approval" },
  { label: "付款审批", value: "payment_approval" },
  { label: "报销审批", value: "reimbursement_approval" }
];

const bootstrapLoading = ref(false);
const bootstrapForm = ref({
  openai_model: "gpt-5.5",
  openai_endpoint: "https://api.openai.com/v1"
});

const handleBootstrapAiConfig = async () => {
  bootstrapLoading.value = true;
  try {
    const result = await bootstrapNearProductionOpenAIConfig({
      openai_model: bootstrapForm.value.openai_model,
      openai_endpoint: bootstrapForm.value.openai_endpoint
    });
    message(
      `初始化完成：供应商 ${result.data.ai_providers_active}，路由 ${result.data.ai_routing_rules_active}，提示词 ${result.data.ai_prompts_active}`,
      { type: "success" }
    );
    await Promise.all([loadProviders(), loadRules(), loadPrompts()]);
  } catch {
    message("AI引擎初始化失败", { type: "error" });
  } finally {
    bootstrapLoading.value = false;
  }
};

const loadProviders = async () => {
  providersLoading.value = true;
  try {
    const result = await listAiProviders();
    providers.value = result.data;
  } finally {
    providersLoading.value = false;
  }
};

const loadRules = async () => {
  rulesLoading.value = true;
  try {
    const result = await listAiRoutingRules();
    rules.value = result.data;
  } finally {
    rulesLoading.value = false;
  }
};

const loadPrompts = async () => {
  promptsLoading.value = true;
  try {
    const result = await listAiPromptTemplates();
    prompts.value = result.data;
  } finally {
    promptsLoading.value = false;
  }
};

const openProviderCreate = () => {
  providerDialogMode.value = "create";
  providerEditingId.value = null;
  providerForm.value = {
    provider_key: "",
    provider_name: "",
    api_endpoint: "",
    model_id: "",
    config_json: "",
    priority: 0,
    max_concurrent: 1
  };
  providerDialogVisible.value = true;
};

const openProviderEdit = (row: AiProviderConfig) => {
  providerDialogMode.value = "edit";
  providerEditingId.value = row.id;
  providerForm.value = {
    provider_key: row.provider_key,
    provider_name: row.provider_name,
    api_endpoint: row.api_endpoint ?? "",
    model_id: row.model_id ?? "",
    config_json: row.config_json ?? "",
    priority: row.priority,
    max_concurrent: row.max_concurrent
  };
  providerDialogVisible.value = true;
};

const saveProvider = async () => {
  if (!providerForm.value.provider_key || !providerForm.value.provider_name) {
    message("请填写必填字段", { type: "warning" });
    return;
  }
  try {
    if (providerDialogMode.value === "create") {
      await createAiProvider({ ...providerForm.value });
      message("创建成功", { type: "success" });
    } else if (providerEditingId.value) {
      await updateAiProvider(providerEditingId.value, {
        provider_name: providerForm.value.provider_name,
        api_endpoint: providerForm.value.api_endpoint || undefined,
        model_id: providerForm.value.model_id || undefined,
        config_json: providerForm.value.config_json || undefined,
        priority: providerForm.value.priority,
        max_concurrent: providerForm.value.max_concurrent
      });
      message("更新成功", { type: "success" });
    }
    providerDialogVisible.value = false;
    await loadProviders();
  } catch {
    message("保存失败", { type: "error" });
  }
};

const deleteProviderRow = async (row: AiProviderConfig) => {
  await deleteAiProvider(row.id);
  message("已删除", { type: "success" });
  await loadProviders();
};

const openRuleCreate = () => {
  ruleDialogMode.value = "create";
  ruleEditingId.value = null;
  ruleForm.value = {
    rule_name: "",
    biz_type: "",
    task_type: "",
    condition_json: "",
    provider_id: undefined,
    prompt_template_id: undefined,
    priority: 0
  };
  ruleDialogVisible.value = true;
};

const openRuleEdit = (row: AiRoutingRule) => {
  ruleDialogMode.value = "edit";
  ruleEditingId.value = row.id;
  ruleForm.value = {
    rule_name: row.rule_name,
    biz_type: row.biz_type,
    task_type: row.task_type,
    condition_json: row.condition_json ?? "",
    provider_id: row.provider_id,
    prompt_template_id: row.prompt_template_id ?? undefined,
    priority: row.priority
  };
  ruleDialogVisible.value = true;
};

const saveRule = async () => {
  if (!ruleForm.value.rule_name || !ruleForm.value.provider_id) {
    message("请填写规则名和供应商", { type: "warning" });
    return;
  }
  try {
    if (ruleDialogMode.value === "create") {
      await createAiRoutingRule({
        rule_name: ruleForm.value.rule_name,
        biz_type: ruleForm.value.biz_type,
        task_type: ruleForm.value.task_type,
        condition_json: ruleForm.value.condition_json || undefined,
        provider_id: ruleForm.value.provider_id,
        prompt_template_id: ruleForm.value.prompt_template_id,
        priority: ruleForm.value.priority
      });
      message("创建成功", { type: "success" });
    } else if (ruleEditingId.value) {
      await updateAiRoutingRule(ruleEditingId.value, { ...ruleForm.value });
      message("更新成功", { type: "success" });
    }
    ruleDialogVisible.value = false;
    await loadRules();
  } catch {
    message("保存失败", { type: "error" });
  }
};

const deleteRuleRow = async (row: AiRoutingRule) => {
  await deleteAiRoutingRule(row.id);
  message("已删除", { type: "success" });
  await loadRules();
};

const openPromptCreate = () => {
  promptDialogMode.value = "create";
  promptEditingId.value = null;
  promptForm.value = {
    template_key: "",
    template_name: "",
    system_prompt: "",
    user_prompt_template: "",
    variables_schema: ""
  };
  promptDialogVisible.value = true;
};

const openPromptEdit = (row: AiPromptTemplate) => {
  promptDialogMode.value = "edit";
  promptEditingId.value = row.id;
  promptForm.value = {
    template_key: row.template_key,
    template_name: row.template_name,
    system_prompt: row.system_prompt,
    user_prompt_template: row.user_prompt_template,
    variables_schema: row.variables_schema ?? ""
  };
  promptDialogVisible.value = true;
};

const savePrompt = async () => {
  if (!promptForm.value.template_key || !promptForm.value.template_name) {
    message("请填写必填字段", { type: "warning" });
    return;
  }
  try {
    if (promptDialogMode.value === "create") {
      await createAiPromptTemplate({
        ...promptForm.value,
        variables_schema: promptForm.value.variables_schema || undefined
      });
      message("创建成功", { type: "success" });
    } else if (promptEditingId.value) {
      await updateAiPromptTemplate(promptEditingId.value, {
        template_name: promptForm.value.template_name,
        system_prompt: promptForm.value.system_prompt,
        user_prompt_template: promptForm.value.user_prompt_template,
        variables_schema: promptForm.value.variables_schema || undefined
      });
      message("更新成功", { type: "success" });
    }
    promptDialogVisible.value = false;
    await loadPrompts();
  } catch {
    message("保存失败", { type: "error" });
  }
};

const deletePromptRow = async (row: AiPromptTemplate) => {
  await deleteAiPromptTemplate(row.id);
  message("已删除", { type: "success" });
  await loadPrompts();
};

const providerName = (id: number) =>
  providers.value.find(p => p.id === id)?.provider_name ?? String(id);

const onTabChange = () => {
  if (activeTab.value === "providers" && !providers.value.length)
    loadProviders();
  if (activeTab.value === "routing" && !rules.value.length) loadRules();
  if (activeTab.value === "prompts" && !prompts.value.length) loadPrompts();
};

onMounted(() => {
  loadProviders();
  loadRules();
  loadPrompts();
});
</script>

<template>
  <el-card shadow="never">
    <el-alert
      :closable="false"
      show-icon
      type="info"
      style="margin-bottom: 12px"
      title="推荐先执行一次初始化"
      description="会预置 OpenAI 供应商、常用任务路由和默认提示词模板。"
    />

    <el-form inline style="margin-bottom: 12px">
      <el-form-item label="默认模型">
        <el-input v-model="bootstrapForm.openai_model" style="width: 220px" />
      </el-form-item>
      <el-form-item label="OpenAI Endpoint">
        <el-input
          v-model="bootstrapForm.openai_endpoint"
          style="width: 320px"
        />
      </el-form-item>
      <el-form-item>
        <el-button
          type="warning"
          :loading="bootstrapLoading"
          @click="handleBootstrapAiConfig"
        >
          一键初始化AI引擎配置
        </el-button>
      </el-form-item>
    </el-form>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane label="AI供应商" name="providers">
        <div style="margin-bottom: 12px; text-align: right">
          <el-button type="primary" @click="openProviderCreate"
            >新增供应商</el-button
          >
        </div>
        <el-table
          v-loading="providersLoading"
          :data="providers"
          style="width: 100%"
        >
          <el-table-column prop="provider_key" label="Key" width="120" />
          <el-table-column prop="provider_name" label="名称" width="140" />
          <el-table-column
            prop="api_endpoint"
            label="Endpoint"
            min-width="200"
            show-overflow-tooltip
          />
          <el-table-column prop="model_id" label="模型" width="140" />
          <el-table-column prop="priority" label="优先级" width="80" />
          <el-table-column prop="max_concurrent" label="并发" width="70" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'active' ? 'success' : 'info'"
                size="small"
                >{{ statusLabel(row.status) }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openProviderEdit(row)"
                >编辑</el-button
              >
              <el-popconfirm
                title="确定删除？"
                @confirm="deleteProviderRow(row)"
              >
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="路由规则" name="routing">
        <div style="margin-bottom: 12px; text-align: right">
          <el-button type="primary" @click="openRuleCreate">新增规则</el-button>
        </div>
        <el-table v-loading="rulesLoading" :data="rules" style="width: 100%">
          <el-table-column prop="rule_name" label="规则名" min-width="140" />
          <el-table-column prop="biz_type" label="业务类型" width="130" />
          <el-table-column prop="task_type" label="任务类型" width="150" />
          <el-table-column label="供应商" width="130">
            <template #default="{ row }">{{
              providerName(row.provider_id)
            }}</template>
          </el-table-column>
          <el-table-column prop="priority" label="优先级" width="80" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'active' ? 'success' : 'info'"
                size="small"
                >{{ statusLabel(row.status) }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openRuleEdit(row)"
                >编辑</el-button
              >
              <el-popconfirm title="确定删除？" @confirm="deleteRuleRow(row)">
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="提示词模板" name="prompts">
        <div style="margin-bottom: 12px; text-align: right">
          <el-button type="primary" @click="openPromptCreate"
            >新增模板</el-button
          >
        </div>
        <el-table
          v-loading="promptsLoading"
          :data="prompts"
          style="width: 100%"
        >
          <el-table-column prop="template_key" label="模板Key" width="160" />
          <el-table-column prop="template_name" label="名称" min-width="160" />
          <el-table-column prop="version" label="版本" width="70" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'active' ? 'success' : 'info'"
                size="small"
                >{{ statusLabel(row.status) }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openPromptEdit(row)"
                >编辑</el-button
              >
              <el-popconfirm title="确定删除？" @confirm="deletePromptRow(row)">
                <template #reference>
                  <el-button link type="danger">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog
    v-model="providerDialogVisible"
    :title="providerDialogMode === 'create' ? '新增供应商' : '编辑供应商'"
    width="560px"
  >
    <el-form label-width="90px">
      <el-form-item label="Provider Key">
        <el-input
          v-model="providerForm.provider_key"
          :disabled="providerDialogMode === 'edit'"
        />
      </el-form-item>
      <el-form-item label="名称">
        <el-input v-model="providerForm.provider_name" />
      </el-form-item>
      <el-form-item label="API Endpoint">
        <el-input v-model="providerForm.api_endpoint" />
      </el-form-item>
      <el-form-item label="模型ID">
        <el-input v-model="providerForm.model_id" />
      </el-form-item>
      <el-form-item label="配置JSON">
        <el-input
          v-model="providerForm.config_json"
          type="textarea"
          :rows="3"
        />
      </el-form-item>
      <el-form-item label="优先级">
        <el-input-number v-model="providerForm.priority" :min="0" />
      </el-form-item>
      <el-form-item label="最大并发">
        <el-input-number v-model="providerForm.max_concurrent" :min="1" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="providerDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveProvider">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="ruleDialogVisible"
    :title="ruleDialogMode === 'create' ? '新增规则' : '编辑规则'"
    width="560px"
  >
    <el-form label-width="100px">
      <el-form-item label="规则名称">
        <el-input v-model="ruleForm.rule_name" />
      </el-form-item>
      <el-form-item label="业务类型">
        <el-select v-model="ruleForm.biz_type" clearable>
          <el-option
            v-for="opt in bizTypeOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="任务类型">
        <el-select v-model="ruleForm.task_type">
          <el-option
            v-for="t in taskTypeOptions"
            :key="t"
            :label="t"
            :value="t"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="供应商">
        <el-select v-model="ruleForm.provider_id" placeholder="选择供应商">
          <el-option
            v-for="p in providers"
            :key="p.id"
            :label="p.provider_name"
            :value="p.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="提示词模板">
        <el-select
          v-model="ruleForm.prompt_template_id"
          clearable
          placeholder="可选"
        >
          <el-option
            v-for="pt in prompts"
            :key="pt.id"
            :label="pt.template_name"
            :value="pt.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="条件JSON">
        <el-input v-model="ruleForm.condition_json" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="优先级">
        <el-input-number v-model="ruleForm.priority" :min="0" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="ruleDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveRule">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="promptDialogVisible"
    :title="promptDialogMode === 'create' ? '新增提示词模板' : '编辑提示词模板'"
    width="640px"
  >
    <el-form label-width="100px">
      <el-form-item label="模板Key">
        <el-input
          v-model="promptForm.template_key"
          :disabled="promptDialogMode === 'edit'"
        />
      </el-form-item>
      <el-form-item label="模板名称">
        <el-input v-model="promptForm.template_name" />
      </el-form-item>
      <el-form-item label="System Prompt">
        <el-input
          v-model="promptForm.system_prompt"
          type="textarea"
          :rows="6"
        />
      </el-form-item>
      <el-form-item label="User Prompt">
        <el-input
          v-model="promptForm.user_prompt_template"
          type="textarea"
          :rows="8"
          placeholder="使用 {{variable}} 表示变量"
        />
      </el-form-item>
      <el-form-item label="变量Schema">
        <el-input
          v-model="promptForm.variables_schema"
          type="textarea"
          :rows="3"
          placeholder="JSON格式的变量定义"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="promptDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="savePrompt">保存</el-button>
    </template>
  </el-dialog>
</template>
