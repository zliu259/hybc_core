<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { message } from "@/utils/message";
import {
  createProjectWeComBinding,
  disableProjectWeComBinding,
  getWeComFrontendConfig,
  getWeComToolManifest,
  listProjectWeComBindings,
  listProjectWeComPushEvents,
  listProjectWeComToolAudits,
  saveWeComGroupWebhook,
  saveWeComToolToken,
  testProjectWeComBinding,
  updateProjectWeComBinding,
  type ProjectWeComBinding,
  type ProjectWeComPushEvent,
  type WeComFrontendConfig,
  type WeComToolCallAudit,
  type WeComToolDefinition
} from "@/api/wecom-tools";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const saving = ref(false);
const disablingId = ref<number | null>(null);
const testingId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const savingToken = ref(false);
const savingWebhook = ref(false);
const bindings = ref<ProjectWeComBinding[]>([]);
const tools = ref<WeComToolDefinition[]>([]);
const audits = ref<WeComToolCallAudit[]>([]);
const pushEvents = ref<ProjectWeComPushEvent[]>([]);
const frontendConfig = ref<WeComFrontendConfig | null>(null);

const configForm = reactive({
  tool_token: "",
  webhook_secret_ref: "",
  webhook_url: ""
});

const form = reactive({
  binding_name: "",
  group_chat_id: "",
  bot_id: "",
  allowed_tools: [] as string[],
  push_webhook_secret_ref: "",
  push_enabled: true,
  qa_enabled: true
});

const toolOptions = computed(() =>
  tools.value
    .filter(tool => tool.access === "read")
    .map(tool => ({
      label: `${tool.title}（${tool.name}）`,
      value: tool.name
    }))
);

const parseAllowedTools = (binding: ProjectWeComBinding) => {
  try {
    const parsed = JSON.parse(binding.allowed_tools_json) as unknown;
    return Array.isArray(parsed) ? parsed.join("、") : "-";
  } catch {
    return "-";
  }
};

const getAllowedTools = (binding: ProjectWeComBinding) => {
  try {
    const parsed = JSON.parse(binding.allowed_tools_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const formatTime = (value: string | null) => {
  if (!value) return "-";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "");
};

const statusTagType = (status: string) => {
  if (status === "sent" || status === "success" || status === "active") {
    return "success";
  }
  if (status === "failed" || status === "forbidden") return "danger";
  if (status === "disabled" || status === "skipped") return "info";
  return "warning";
};

const resetForm = () => {
  editingId.value = null;
  form.binding_name = "";
  form.group_chat_id = "";
  form.bot_id = "";
  form.allowed_tools = toolOptions.value.map(item => item.value);
  form.push_webhook_secret_ref = "";
  form.push_enabled = true;
  form.qa_enabled = true;
};

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    const [configRes, manifestRes, bindingsRes, auditsRes, pushEventsRes] =
      await Promise.all([
        getWeComFrontendConfig(),
        getWeComToolManifest(),
        listProjectWeComBindings(props.projectId),
        listProjectWeComToolAudits(props.projectId),
        listProjectWeComPushEvents(props.projectId)
      ]);
    frontendConfig.value = configRes.data;
    tools.value = manifestRes.data.tools;
    bindings.value = bindingsRes.data;
    audits.value = auditsRes.data;
    pushEvents.value = pushEventsRes.data;
    if (form.allowed_tools.length === 0) {
      form.allowed_tools = manifestRes.data.tools
        .filter(tool => tool.access === "read")
        .map(tool => tool.name);
    }
  } catch {
    message("企业微信群配置加载失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const copyText = async (value: string | undefined) => {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    message("已复制", { type: "success" });
  } catch {
    message("复制失败，请手动复制", { type: "warning" });
  }
};

const saveToolToken = async () => {
  if (!configForm.tool_token.trim()) {
    message("请填写工具调用 Token", { type: "warning" });
    return;
  }
  savingToken.value = true;
  try {
    await saveWeComToolToken({ token: configForm.tool_token.trim() });
    configForm.tool_token = "";
    message("工具调用 Token 已保存", { type: "success" });
    await loadData();
  } catch {
    message("工具调用 Token 保存失败，至少需要 16 位", { type: "error" });
  } finally {
    savingToken.value = false;
  }
};

const saveWebhook = async () => {
  if (!configForm.webhook_secret_ref.trim()) {
    message("请填写 Webhook Secret Ref", { type: "warning" });
    return;
  }
  if (!configForm.webhook_url.trim()) {
    message("请填写企业微信群机器人 Webhook URL", { type: "warning" });
    return;
  }
  savingWebhook.value = true;
  try {
    const secretRef = configForm.webhook_secret_ref.trim();
    await saveWeComGroupWebhook({
      secret_ref: secretRef,
      webhook_url: configForm.webhook_url.trim()
    });
    form.push_webhook_secret_ref = secretRef;
    configForm.webhook_url = "";
    message("Webhook 已保存，可直接用于项目绑定", { type: "success" });
  } catch {
    message("Webhook 保存失败，请确认 URL 来自企业微信群机器人", {
      type: "error"
    });
  } finally {
    savingWebhook.value = false;
  }
};

const buildPayload = () => ({
  binding_name: form.binding_name.trim(),
  group_chat_id: form.group_chat_id.trim() || null,
  bot_id: form.bot_id.trim() || null,
  allowed_tools: form.allowed_tools,
  push_webhook_secret_ref: form.push_webhook_secret_ref.trim() || null,
  push_enabled: form.push_enabled,
  qa_enabled: form.qa_enabled
});

const submit = async () => {
  if (!form.binding_name.trim()) {
    message("请填写绑定名称", { type: "warning" });
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await updateProjectWeComBinding(
        props.projectId,
        editingId.value,
        buildPayload()
      );
      message("企业微信群绑定已更新", { type: "success" });
    } else {
      await createProjectWeComBinding(props.projectId, buildPayload());
      message("企业微信群绑定已保存", { type: "success" });
    }
    resetForm();
    await loadData();
  } catch {
    message("企业微信群绑定保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const editBinding = (binding: ProjectWeComBinding) => {
  editingId.value = binding.id;
  form.binding_name = binding.binding_name;
  form.group_chat_id = binding.group_chat_id ?? "";
  form.bot_id = binding.bot_id ?? "";
  form.allowed_tools = getAllowedTools(binding);
  form.push_webhook_secret_ref = binding.push_webhook_secret_ref ?? "";
  form.push_enabled = binding.push_enabled === 1;
  form.qa_enabled = binding.qa_enabled === 1;
};

const testBinding = async (binding: ProjectWeComBinding) => {
  testingId.value = binding.id;
  try {
    await testProjectWeComBinding(props.projectId, binding.id);
    message("测试推送已发送", { type: "success" });
    await loadData();
  } catch {
    message("测试推送失败，请检查 Webhook Secret Ref", { type: "error" });
  } finally {
    testingId.value = null;
  }
};

const disableBinding = async (binding: ProjectWeComBinding) => {
  disablingId.value = binding.id;
  try {
    await disableProjectWeComBinding(props.projectId, binding.id);
    message("绑定已停用", { type: "success" });
    await loadData();
  } catch {
    message("绑定停用失败", { type: "error" });
  } finally {
    disablingId.value = null;
  }
};

onMounted(loadData);
watch(() => props.projectId, loadData);
</script>

<template>
  <el-card class="wecom-tool-panel" shadow="never">
    <template #header>
      <div class="panel-header">
        <div>
          <div class="panel-title">企业微信群与智能机器人</div>
          <div class="panel-subtitle">
            机器人问答调用项目工具，日志通知走群机器人 Webhook
          </div>
        </div>
        <el-button :loading="loading" @click="loadData">刷新</el-button>
      </div>
    </template>

    <div v-loading="loading" class="panel-body">
      <div class="config-section">
        <div class="section-title">智能机器人接入配置</div>
        <el-row :gutter="16">
          <el-col :md="12" :sm="24">
            <el-form label-width="120px">
              <el-form-item label="工具清单地址">
                <el-input
                  :model-value="frontendConfig?.manifest_url || ''"
                  readonly
                >
                  <template #append>
                    <el-button @click="copyText(frontendConfig?.manifest_url)">
                      复制
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
              <el-form-item label="工具调用地址">
                <el-input
                  :model-value="frontendConfig?.call_url || ''"
                  readonly
                >
                  <template #append>
                    <el-button @click="copyText(frontendConfig?.call_url)">
                      复制
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-form>
          </el-col>
          <el-col :md="12" :sm="24">
            <el-form :model="configForm" label-width="120px">
              <el-form-item label="Token 状态">
                <el-tag
                  :type="
                    frontendConfig?.tool_token_configured ? 'success' : 'info'
                  "
                >
                  {{
                    frontendConfig?.tool_token_configured
                      ? `已配置（${frontendConfig.tool_token_source}）`
                      : "未配置"
                  }}
                </el-tag>
              </el-form-item>
              <el-form-item label="工具 Token">
                <el-input
                  v-model="configForm.tool_token"
                  type="password"
                  show-password
                  placeholder="留空不修改，保存后不回显"
                >
                  <template #append>
                    <el-button :loading="savingToken" @click="saveToolToken">
                      保存
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-form>
          </el-col>
        </el-row>

        <el-form :model="configForm" label-width="140px" class="webhook-form">
          <el-row :gutter="16">
            <el-col :md="8" :sm="24">
              <el-form-item label="Webhook Secret Ref">
                <el-input
                  v-model="configForm.webhook_secret_ref"
                  placeholder="如：prod-east"
                />
              </el-form-item>
            </el-col>
            <el-col :md="16" :sm="24">
              <el-form-item label="群机器人 URL">
                <el-input
                  v-model="configForm.webhook_url"
                  type="password"
                  show-password
                  placeholder="企业微信群机器人 Webhook URL，保存后不回显"
                >
                  <template #append>
                    <el-button :loading="savingWebhook" @click="saveWebhook">
                      保存 Webhook
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <div class="section-title">项目群绑定</div>
      <el-form :model="form" label-width="140px" class="binding-form">
        <el-row :gutter="16">
          <el-col :md="8" :sm="24">
            <el-form-item label="绑定名称">
              <el-input
                v-model="form.binding_name"
                placeholder="如：东线项目群"
              />
            </el-form-item>
          </el-col>
          <el-col :md="8" :sm="24">
            <el-form-item label="群聊 ID">
              <el-input
                v-model="form.group_chat_id"
                placeholder="企业微信群 ID"
              />
            </el-form-item>
          </el-col>
          <el-col :md="8" :sm="24">
            <el-form-item label="机器人 ID">
              <el-input v-model="form.bot_id" placeholder="智能机器人 ID" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="允许工具">
          <el-select
            v-model="form.allowed_tools"
            multiple
            collapse-tags
            collapse-tags-tooltip
            style="width: 100%"
          >
            <el-option
              v-for="tool in toolOptions"
              :key="tool.value"
              :label="tool.label"
              :value="tool.value"
            />
          </el-select>
        </el-form-item>

        <el-row :gutter="16">
          <el-col :md="12" :sm="24">
            <el-form-item label="Webhook Secret Ref">
              <el-input
                v-model="form.push_webhook_secret_ref"
                placeholder="如：prod-east"
              />
            </el-form-item>
          </el-col>
          <el-col :md="12" :sm="24">
            <el-form-item label="启用能力">
              <el-checkbox v-model="form.qa_enabled">问答工具</el-checkbox>
              <el-checkbox v-model="form.push_enabled">日志推送</el-checkbox>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="submit">
            {{ editingId ? "更新绑定" : "保存绑定" }}
          </el-button>
          <el-button v-if="editingId" :disabled="saving" @click="resetForm">
            取消编辑
          </el-button>
        </el-form-item>
      </el-form>

      <el-table :data="bindings" border empty-text="暂无群绑定">
        <el-table-column prop="binding_name" label="绑定名称" min-width="150" />
        <el-table-column prop="group_chat_id" label="群聊 ID" min-width="160" />
        <el-table-column prop="bot_id" label="机器人 ID" min-width="140" />
        <el-table-column
          prop="push_webhook_secret_ref"
          label="Webhook Ref"
          min-width="140"
        />
        <el-table-column label="允许工具" min-width="220">
          <template #default="{ row }">
            {{ parseAllowedTools(row) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editBinding(row)">
              编辑
            </el-button>
            <el-button
              link
              type="primary"
              :loading="testingId === row.id"
              :disabled="row.status !== 'active' || row.push_enabled !== 1"
              @click="testBinding(row)"
            >
              测试推送
            </el-button>
            <el-button
              link
              type="danger"
              :loading="disablingId === row.id"
              :disabled="row.status !== 'active'"
              @click="disableBinding(row)"
            >
              停用
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-tabs class="records-section">
        <el-tab-pane label="工具调用记录">
          <el-table :data="audits" border empty-text="暂无工具调用记录">
            <el-table-column prop="tool_name" label="工具" min-width="180" />
            <el-table-column
              prop="caller_userid"
              label="调用人"
              min-width="120"
            />
            <el-table-column
              prop="group_chat_id"
              label="群聊 ID"
              min-width="160"
            />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="latency_ms" label="耗时(ms)" width="100" />
            <el-table-column label="错误" min-width="180">
              <template #default="{ row }">
                {{ row.error_message || "-" }}
              </template>
            </el-table-column>
            <el-table-column label="时间" min-width="170">
              <template #default="{ row }">
                {{ formatTime(row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="推送结果">
          <el-table :data="pushEvents" border empty-text="暂无推送结果">
            <el-table-column
              prop="source_event_type"
              label="事件"
              min-width="160"
            />
            <el-table-column
              prop="source_biz_type"
              label="业务类型"
              min-width="110"
            />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              prop="webhook_secret_ref"
              label="Webhook Ref"
              min-width="130"
            />
            <el-table-column label="摘要" min-width="240">
              <template #default="{ row }">
                {{ row.message_summary || "-" }}
              </template>
            </el-table-column>
            <el-table-column label="错误" min-width="180">
              <template #default="{ row }">
                {{ row.error_message || "-" }}
              </template>
            </el-table-column>
            <el-table-column label="推送时间" min-width="170">
              <template #default="{ row }">
                {{ formatTime(row.pushed_at || row.created_at) }}
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-card>
</template>

<style scoped>
.wecom-tool-panel {
  margin-top: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
}

.panel-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.panel-body {
  min-height: 160px;
}

.config-section {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.section-title {
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
}

.webhook-form {
  margin-top: 4px;
}

.binding-form {
  margin-bottom: 16px;
}

.records-section {
  margin-top: 16px;
}
</style>
