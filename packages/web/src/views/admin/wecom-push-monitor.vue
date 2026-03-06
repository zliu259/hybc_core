<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  getWeComPushMonitor,
  listRunnerRuntimeConfig,
  upsertRunnerRuntimeConfig,
  type WeComPushMonitorEvent,
  type WeComPushMonitorResponse
} from "@/api/admin";
import { message } from "@/utils/message";

defineOptions({ name: "AdminWeComPushMonitor" });

const loading = ref(false);
const saving = ref(false);
const hours = ref(24);
const state = ref<WeComPushMonitorResponse | null>(null);
const configForm = ref({
  WECOM_MINIAPP_APPID: "",
  WECOM_APPROVAL_WEB_BASE_URL: "",
  WECOM_APPROVAL_MINI_PAGE_PATH: "pages/approval-detail/index?id={id}",
  WECOM_APPROVAL_DEFAULT_TARGET: "miniapp" as "web" | "miniapp"
});

const totals = computed(() =>
  state.value?.totals ?? {
    sent_count: 0,
    failed_count: 0,
    isolation_guard_count: 0,
    summary_count: 0,
    success_rate: 0
  }
);

const successRatePercent = computed(() => Number((totals.value.success_rate * 100).toFixed(2)));

const recentRows = computed<WeComPushMonitorEvent[]>(() => state.value?.recent ?? []);

const topErrors = computed(() => state.value?.top_errors ?? []);

const eventTypeTag = (type: string): "success" | "danger" | "warning" | "info" => {
  if (type === "wecom_template_card_sent") return "success";
  if (type === "wecom_template_card_failed") return "danger";
  if (type === "wecom_template_card_isolation_guard") return "warning";
  return "info";
};

const payloadPreview = (payload: Record<string, unknown> | null): string => {
  if (!payload) return "-";
  const error = typeof payload.error === "string" ? payload.error : "";
  if (error) return error;

  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((item): item is string => typeof item === "string")
    : [];
  if (errors.length > 0) return errors.slice(0, 2).join(" | ");

  const instanceId = payload.instance_id;
  const assignee = payload.assignee_userid;
  if (instanceId || assignee) {
    return `instance=${String(instanceId ?? "-")}, assignee=${String(assignee ?? "-")}`;
  }

  return JSON.stringify(payload).slice(0, 180);
};

const refresh = async () => {
  loading.value = true;
  try {
    const result = await getWeComPushMonitor({
      hours: hours.value,
      limit: 200
    });
    state.value = result.data;
  } finally {
    loading.value = false;
  }
};

const loadConfig = async () => {
  const result = await listRunnerRuntimeConfig();
  const configMap = new Map(result.data.map((item) => [item.config_key, item.config_value]));
  configForm.value.WECOM_MINIAPP_APPID = configMap.get("WECOM_MINIAPP_APPID") || "";
  configForm.value.WECOM_APPROVAL_WEB_BASE_URL =
    configMap.get("WECOM_APPROVAL_WEB_BASE_URL") || "";
  configForm.value.WECOM_APPROVAL_MINI_PAGE_PATH =
    configMap.get("WECOM_APPROVAL_MINI_PAGE_PATH") || "pages/approval-detail/index?id={id}";
  const target = configMap.get("WECOM_APPROVAL_DEFAULT_TARGET");
  configForm.value.WECOM_APPROVAL_DEFAULT_TARGET = target === "web" ? "web" : "miniapp";
};

const saveConfig = async () => {
  const hasMini = configForm.value.WECOM_MINIAPP_APPID.trim().length > 0;
  const hasWeb = configForm.value.WECOM_APPROVAL_WEB_BASE_URL.trim().length > 0;
  if (!hasMini && !hasWeb) {
    message("至少需要配置小程序或 Web 跳转之一", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    await upsertRunnerRuntimeConfig([
      {
        config_key: "WECOM_MINIAPP_APPID",
        config_value: configForm.value.WECOM_MINIAPP_APPID.trim(),
        is_secret: false
      },
      {
        config_key: "WECOM_APPROVAL_WEB_BASE_URL",
        config_value: configForm.value.WECOM_APPROVAL_WEB_BASE_URL.trim(),
        is_secret: false
      },
      {
        config_key: "WECOM_APPROVAL_MINI_PAGE_PATH",
        config_value: configForm.value.WECOM_APPROVAL_MINI_PAGE_PATH.trim(),
        is_secret: false
      },
      {
        config_key: "WECOM_APPROVAL_DEFAULT_TARGET",
        config_value: configForm.value.WECOM_APPROVAL_DEFAULT_TARGET,
        is_secret: false
      }
    ]);
    message("推送跳转配置已保存", { type: "success" });
  } finally {
    saving.value = false;
  }
};

onMounted(async () => {
  await Promise.all([refresh(), loadConfig()]);
});
</script>

<template>
  <el-card shadow="never" style="margin-bottom: 16px">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px">
        <span>推送跳转配置（超管）</span>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
      </div>
    </template>

    <el-form label-width="220px" style="max-width: 920px">
      <el-form-item label="WECOM_MINIAPP_APPID">
        <el-input
          v-model="configForm.WECOM_MINIAPP_APPID"
          placeholder="wx1234567890abcdef（可选，与Web二选一至少配置一个）"
        />
      </el-form-item>
      <el-form-item label="WECOM_APPROVAL_WEB_BASE_URL">
        <el-input
          v-model="configForm.WECOM_APPROVAL_WEB_BASE_URL"
          placeholder="https://your-web-domain.com（可选，与小程序二选一至少配置一个）"
        />
      </el-form-item>
      <el-form-item label="WECOM_APPROVAL_MINI_PAGE_PATH">
        <el-input
          v-model="configForm.WECOM_APPROVAL_MINI_PAGE_PATH"
          placeholder="pages/approval-detail/index?id={id}"
        />
      </el-form-item>
      <el-form-item label="WECOM_APPROVAL_DEFAULT_TARGET">
        <el-radio-group v-model="configForm.WECOM_APPROVAL_DEFAULT_TARGET">
          <el-radio label="miniapp">miniapp</el-radio>
          <el-radio label="web">web</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
  </el-card>

  <el-card shadow="never" style="margin-bottom: 16px">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px">
        <span>企业微信推送状态监控</span>
        <div style="display: flex; gap: 8px; align-items: center">
          <el-select v-model="hours" style="width: 120px" @change="refresh">
            <el-option :value="1" label="最近1小时" />
            <el-option :value="6" label="最近6小时" />
            <el-option :value="24" label="最近24小时" />
            <el-option :value="72" label="最近72小时" />
            <el-option :value="168" label="最近7天" />
          </el-select>
          <el-button type="primary" :loading="loading" @click="refresh">刷新</el-button>
        </div>
      </div>
    </template>

    <el-row :gutter="16">
      <el-col :span="6">
        <el-statistic title="发送成功" :value="totals.sent_count" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="发送失败" :value="totals.failed_count" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="隔离保护触发" :value="totals.isolation_guard_count" />
      </el-col>
      <el-col :span="6">
        <el-statistic title="成功率" :value="successRatePercent">
          <template #suffix>%</template>
        </el-statistic>
      </el-col>
    </el-row>

    <div style="margin-top: 12px; color: var(--el-text-color-secondary)">
      时间窗口：最近 {{ state?.window_hours ?? hours }} 小时；起始时间：{{ state?.since ?? "-" }}
    </div>
  </el-card>

  <el-card shadow="never" header="高频错误 Top 10" style="margin-bottom: 16px">
    <el-table v-loading="loading" :data="topErrors" style="width: 100%" empty-text="暂无错误">
      <el-table-column prop="message" label="错误信息" min-width="680" show-overflow-tooltip />
      <el-table-column prop="count" label="出现次数" width="120" />
    </el-table>
  </el-card>

  <el-card shadow="never" header="最近推送事件">
    <el-table v-loading="loading" :data="recentRows" style="width: 100%" empty-text="暂无事件">
      <el-table-column prop="id" label="ID" width="90" />
      <el-table-column label="事件类型" width="260">
        <template #default="{ row }">
          <el-tag :type="eventTypeTag(row.event_type)" size="small">{{ row.event_type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="event_source" label="来源" width="160" />
      <el-table-column label="负载摘要" min-width="520" show-overflow-tooltip>
        <template #default="{ row }">
          {{ payloadPreview(row.payload) }}
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="时间" width="220" />
    </el-table>
  </el-card>
</template>
