<script setup lang="ts">
import { computed, ref } from "vue";
import { message } from "@/utils/message";
import {
  AGENT_TYPE_LABELS,
  provisionAgent,
  type AgentProvisionResult
} from "@/api/agent";

defineOptions({ name: "AgentSetup" });

const AGENT_OPTIONS = Object.entries(AGENT_TYPE_LABELS).map(
  ([value, label]) => ({
    value,
    label: value === "claude_code" ? `${label}（推荐）` : label
  })
);

const agentType = ref("claude_code");
const deviceName = ref("");
const generating = ref(false);
const result = ref<AgentProvisionResult | null>(null);

const validMinutes = computed(() =>
  result.value ? Math.round(result.value.expires_in / 60) : 0
);

const onGenerate = async () => {
  if (!deviceName.value.trim()) {
    message("请先填写设备名称（如：张三的 MacBook）", { type: "warning" });
    return;
  }
  generating.value = true;
  try {
    const res = await provisionAgent({
      device_name: deviceName.value.trim(),
      agent_type: agentType.value
    });
    result.value = res.data;
    message(`安装命令已生成，${validMinutes.value} 分钟内有效`, {
      type: "success"
    });
  } catch {
    message("生成失败，请稍后再试", { type: "error" });
  } finally {
    generating.value = false;
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
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div>
          <span style="font-weight: 600">智能体接入配置</span>
          <div style="margin-top: 4px; font-size: 12px; color: #909399">
            为你的 AI 编程助手（如 Claude Code）开通公司系统只读访问。授权有效期
            180 天，可随时在「设备授权」页吊销。
          </div>
        </div>
      </template>

      <el-form label-width="88px" style="max-width: 560px">
        <el-form-item label="Agent 类型">
          <el-radio-group v-model="agentType">
            <el-radio-button
              v-for="opt in AGENT_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="设备名称">
          <el-input
            v-model="deviceName"
            placeholder="如：张三的 MacBook"
            maxlength="40"
            style="width: 320px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="generating" @click="onGenerate">
            生成安装命令
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="result" shadow="never" style="margin-top: 16px">
      <template #header>
        <span style="font-weight: 600">
          安装命令（一次性，{{ validMinutes }} 分钟内有效）
        </span>
      </template>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="命令包含一次性授权码，请勿转发给他人；访问令牌不会显示在屏幕上。"
        style="margin-bottom: 12px"
      />
      <div class="cmd-block">
        <div class="cmd-label">macOS / Linux（终端执行）</div>
        <el-input :model-value="result.install_sh" readonly>
          <template #append>
            <el-button @click="copyText(result.install_sh)">复制</el-button>
          </template>
        </el-input>
      </div>
      <div class="cmd-block" style="margin-top: 12px">
        <div class="cmd-label">Windows（PowerShell 执行）</div>
        <el-input :model-value="result.install_ps1" readonly>
          <template #append>
            <el-button @click="copyText(result.install_ps1)">复制</el-button>
          </template>
        </el-input>
      </div>
      <div style="margin-top: 12px; font-size: 12px; color: #909399">
        执行后安装器会自动下载 MCP、完成授权并配置所选 Agent。完成后可在
        <router-link to="/agent/grants">设备授权</router-link> 页查看或吊销。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.cmd-label {
  margin-bottom: 4px;
  font-size: 12px;
  color: #606266;
}
</style>
