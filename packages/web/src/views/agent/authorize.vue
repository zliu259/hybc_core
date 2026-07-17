<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import {
  approveDevice,
  denyDevice,
  getDeviceInfo,
  type AgentDeviceInfo
} from "@/api/agent";

defineOptions({ name: "AgentAuthorize" });

const route = useRoute();
const userCode = ref("");
const info = ref<AgentDeviceInfo | null>(null);
const loading = ref(false);
const acting = ref(false);
const decided = ref<"approved" | "denied" | null>(null);

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_desktop: "Claude Desktop"
};

const agentLabel = (value: string | null) =>
  (value && AGENT_LABELS[value]) || value || "未知 Agent";

const normalizeCode = (raw: string) => raw.trim().toUpperCase();

const loadInfo = async () => {
  const code = normalizeCode(userCode.value);
  if (!code) {
    message("请输入设备授权码（形如 ABCD-EFGH）", { type: "warning" });
    return;
  }
  loading.value = true;
  info.value = null;
  decided.value = null;
  try {
    const res = await getDeviceInfo(code);
    info.value = res.data;
    if (res.data.status !== "pending") {
      decided.value = res.data.status === "approved" ? "approved" : "denied";
    }
  } catch {
    message("授权码无效或已过期，请回到设备上重新发起", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const onApprove = async () => {
  if (!info.value) return;
  acting.value = true;
  try {
    await approveDevice(info.value.user_code);
    decided.value = "approved";
    message("已授权。请回到设备上继续，令牌将自动发放。", { type: "success" });
  } catch {
    message("授权失败，授权码可能已过期", { type: "error" });
  } finally {
    acting.value = false;
  }
};

const onDeny = async () => {
  if (!info.value) return;
  acting.value = true;
  try {
    await denyDevice(info.value.user_code);
    decided.value = "denied";
    message("已拒绝该设备的接入请求", { type: "success" });
  } catch {
    message("操作失败，授权码可能已过期", { type: "error" });
  } finally {
    acting.value = false;
  }
};

onMounted(() => {
  const q = route.query.user_code;
  if (typeof q === "string" && q) {
    userCode.value = q;
    void loadInfo();
  }
});
</script>

<template>
  <div class="p-4" style="max-width: 640px">
    <el-card shadow="never">
      <template #header>
        <span style="font-weight: 600">设备授权确认</span>
      </template>

      <el-form label-width="88px">
        <el-form-item label="授权码">
          <el-input
            v-model="userCode"
            placeholder="ABCD-EFGH"
            style="width: 220px"
            @input="info = null"
            @keyup.enter="loadInfo"
          />
          <el-button
            style="margin-left: 8px"
            :loading="loading"
            @click="loadInfo"
          >
            查询
          </el-button>
        </el-form-item>
      </el-form>

      <template v-if="info">
        <el-descriptions :column="1" border style="margin-top: 8px">
          <el-descriptions-item label="设备名称">
            {{ info.device_name || "未命名设备" }}
          </el-descriptions-item>
          <el-descriptions-item label="Agent">
            {{ agentLabel(info.agent_type) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="info.client_info" label="客户端">
            {{ info.client_info }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="!decided"
          type="warning"
          :closable="false"
          show-icon
          title="授权后，该设备上的 AI 助手将以你的身份【只读】访问公司系统（项目、付款、审批、合同、库房查询）。有效期 180 天，可随时吊销。"
          style="margin-top: 12px"
        />

        <el-result
          v-if="decided === 'approved'"
          icon="success"
          title="已授权"
          sub-title="请回到设备上继续，令牌将自动发放。可关闭本页。"
        />
        <el-result
          v-else-if="decided === 'denied'"
          icon="error"
          title="已拒绝"
          sub-title="该设备的接入请求已被拒绝。可关闭本页。"
        />

        <div v-if="!decided" style="margin-top: 16px">
          <el-button type="primary" :loading="acting" @click="onApprove">
            同意授权
          </el-button>
          <el-button type="danger" plain :loading="acting" @click="onDeny">
            拒绝
          </el-button>
        </div>
      </template>
    </el-card>
  </div>
</template>
