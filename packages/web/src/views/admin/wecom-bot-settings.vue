<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { formatBeijingDateTime } from "@/utils/datetime";
import { message } from "@/utils/message";
import {
  getWeComFrontendConfig,
  getWeComToolManifest,
  listWeComGroupChats,
  saveWeComGroupChatManual,
  saveWeComGroupWebhook,
  saveWeComToolToken,
  syncWeComExternalGroupChats,
  type WeComFrontendConfig,
  type WeComGroupChat,
  type WeComGroupChatType,
  type WeComToolDefinition
} from "@/api/wecom-tools";

const loading = ref(false);
const savingToken = ref(false);
const savingWebhook = ref(false);
const savingGroup = ref(false);
const syncingGroups = ref(false);
const groupLoading = ref(false);
const frontendConfig = ref<WeComFrontendConfig | null>(null);
const tools = ref<WeComToolDefinition[]>([]);
const groupChats = ref<WeComGroupChat[]>([]);
const groupKeyword = ref("");

const configForm = reactive({
  tool_token: "",
  webhook_secret_ref: "",
  webhook_url: ""
});

const groupForm = reactive({
  chat_id: "",
  chat_name: "",
  chat_type: "manual" as WeComGroupChatType,
  owner_userid: "",
  webhook_secret_ref: ""
});

const toolRows = computed(() =>
  tools.value.map(tool => ({
    ...tool,
    accessText: tool.access === "read" ? "只读" : "写入"
  }))
);

const chatTypeOptions: Array<{ label: string; value: WeComGroupChatType }> = [
  { label: "手动登记", value: "manual" },
  { label: "内部群", value: "internal" },
  { label: "外部客户群", value: "external_customer_group" },
  { label: "工具调用发现", value: "discovered" }
];

const chatTypeLabel = (value: string) => {
  return chatTypeOptions.find(item => item.value === value)?.label ?? value;
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

const loadConfig = async () => {
  loading.value = true;
  try {
    const [configRes, manifestRes] = await Promise.all([
      getWeComFrontendConfig(),
      getWeComToolManifest()
    ]);
    frontendConfig.value = configRes.data;
    tools.value = manifestRes.data.tools;
  } catch {
    message("智能机器人配置加载失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const loadGroupChats = async (keyword = groupKeyword.value) => {
  groupLoading.value = true;
  try {
    const res = await listWeComGroupChats(keyword);
    groupChats.value = res.data;
  } catch {
    message("群聊目录加载失败", { type: "error" });
  } finally {
    groupLoading.value = false;
  }
};

const loadData = async () => {
  await Promise.all([loadConfig(), loadGroupChats()]);
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
    await loadConfig();
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
    await saveWeComGroupWebhook({
      secret_ref: configForm.webhook_secret_ref.trim(),
      webhook_url: configForm.webhook_url.trim()
    });
    groupForm.webhook_secret_ref = configForm.webhook_secret_ref.trim();
    configForm.webhook_url = "";
    message("Webhook 已保存，可用于项目群绑定", { type: "success" });
  } catch {
    message("Webhook 保存失败，请确认 URL 来自企业微信群机器人", {
      type: "error"
    });
  } finally {
    savingWebhook.value = false;
  }
};

const saveGroupChat = async () => {
  if (!groupForm.chat_name.trim()) {
    message("请填写群聊名称", { type: "warning" });
    return;
  }
  if (!groupForm.chat_id.trim()) {
    message("请填写群聊 ID", { type: "warning" });
    return;
  }
  savingGroup.value = true;
  try {
    await saveWeComGroupChatManual({
      chat_id: groupForm.chat_id.trim(),
      chat_name: groupForm.chat_name.trim(),
      chat_type: groupForm.chat_type,
      owner_userid: groupForm.owner_userid.trim() || null,
      webhook_secret_ref: groupForm.webhook_secret_ref.trim() || null
    });
    groupForm.chat_id = "";
    groupForm.chat_name = "";
    groupForm.owner_userid = "";
    message("群聊已加入目录", { type: "success" });
    await loadGroupChats();
  } catch {
    message("群聊保存失败", { type: "error" });
  } finally {
    savingGroup.value = false;
  }
};

const syncExternalGroups = async () => {
  syncingGroups.value = true;
  try {
    const res = await syncWeComExternalGroupChats();
    message(`外部客户群同步完成：新增/更新 ${res.data.synced} 个`, {
      type: "success"
    });
    await loadGroupChats();
  } catch {
    message("外部客户群同步失败，请检查客户联系密钥、可信 IP 与桥接服务", {
      type: "error"
    });
  } finally {
    syncingGroups.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <div class="wecom-bot-settings">
    <div class="page-header">
      <div>
        <div class="page-title">企业微信智能机器人设置</div>
        <div class="page-subtitle">企业级工具接入、Webhook 密钥和群聊目录</div>
      </div>
      <el-button :loading="loading || groupLoading" @click="loadData">
        刷新
      </el-button>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="section-title">智能机器人工具接入</div>
      </template>
      <div v-loading="loading">
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
                  placeholder="保存后不回显"
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

        <el-table :data="toolRows" border empty-text="暂无工具清单">
          <el-table-column prop="title" label="工具" min-width="150" />
          <el-table-column prop="name" label="工具名" min-width="220" />
          <el-table-column prop="accessText" label="权限" width="90" />
          <el-table-column prop="scope" label="范围" width="100" />
          <el-table-column prop="description" label="说明" min-width="260" />
        </el-table>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="section-title">群机器人 Webhook 密钥</div>
      </template>
      <el-form :model="configForm" label-width="150px">
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
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="section-header">
          <div class="section-title">群聊目录</div>
          <el-button
            type="primary"
            plain
            :loading="syncingGroups"
            @click="syncExternalGroups"
          >
            同步外部客户群
          </el-button>
        </div>
      </template>

      <el-form :model="groupForm" label-width="120px" class="group-form">
        <el-row :gutter="16">
          <el-col :md="6" :sm="24">
            <el-form-item label="群聊名称">
              <el-input
                v-model="groupForm.chat_name"
                placeholder="项目群名称"
              />
            </el-form-item>
          </el-col>
          <el-col :md="6" :sm="24">
            <el-form-item label="群聊 ID">
              <el-input
                v-model="groupForm.chat_id"
                placeholder="group_chat_id"
              />
            </el-form-item>
          </el-col>
          <el-col :md="4" :sm="24">
            <el-form-item label="群类型">
              <el-select v-model="groupForm.chat_type" style="width: 100%">
                <el-option
                  v-for="item in chatTypeOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :md="4" :sm="24">
            <el-form-item label="群主 userid">
              <el-input v-model="groupForm.owner_userid" placeholder="可选" />
            </el-form-item>
          </el-col>
          <el-col :md="4" :sm="24">
            <el-form-item label="Webhook Ref">
              <el-input
                v-model="groupForm.webhook_secret_ref"
                placeholder="可选"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item>
          <el-button
            type="primary"
            :loading="savingGroup"
            @click="saveGroupChat"
          >
            添加到目录
          </el-button>
        </el-form-item>
      </el-form>

      <div class="table-toolbar">
        <el-input
          v-model="groupKeyword"
          clearable
          placeholder="搜索群名、群 ID、群主 userid"
          @keyup.enter="loadGroupChats()"
          @clear="loadGroupChats('')"
        >
          <template #append>
            <el-button :loading="groupLoading" @click="loadGroupChats()">
              搜索
            </el-button>
          </template>
        </el-input>
      </div>

      <el-table
        v-loading="groupLoading"
        :data="groupChats"
        border
        empty-text="暂无群聊目录"
      >
        <el-table-column prop="chat_name" label="群聊名称" min-width="180" />
        <el-table-column prop="chat_id" label="群聊 ID" min-width="180" />
        <el-table-column label="类型" min-width="130">
          <template #default="{ row }">
            {{ chatTypeLabel(row.chat_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="owner_userid" label="群主" min-width="120" />
        <el-table-column
          prop="webhook_secret_ref"
          label="Webhook Ref"
          min-width="140"
        />
        <el-table-column prop="source" label="来源" width="130" />
        <el-table-column label="更新时间" min-width="170">
          <template #default="{ row }">
            {{ formatBeijingDateTime(row.updated_at) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.wecom-bot-settings {
  padding: 16px;
}

.page-header,
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-header {
  margin-bottom: 16px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
}

.page-subtitle {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.el-card + .el-card {
  margin-top: 16px;
}

.group-form,
.table-toolbar {
  margin-bottom: 16px;
}

.table-toolbar {
  max-width: 520px;
}
</style>
