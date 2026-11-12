<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";

import {
  getWedriveStatus,
  openWedriveSpace,
  retryFailedMirrors,
  saveWedriveSettings,
  setupWedrive,
  type WedriveStatus
} from "@/api/wh/wedrive";
import type { ApiResult } from "@/api/wh/types";
import { message } from "@/utils/message";
import { useWhAction } from "../../shared/useWhAction";
import {
  mirrorActions,
  mirrorAudienceText,
  mirrorCallsText,
  mirrorCountItems,
  mirrorHeadline
} from "../wedrive-view";

/**
 * 设备资料库的微盘镜像：现在什么状态、本月用了多少次调用、能做哪些动作。
 * 出哪些按钮由 mirrorActions 决定；只有经理和超管能动，库管和资料管理员只能看。
 */
const props = defineProps<{ canManage: boolean }>();

const { busy, run } = useWhAction();
const status = ref<WedriveStatus | null>(null);

const headline = computed(() =>
  status.value ? mirrorHeadline(status.value) : null
);
const actions = computed(() =>
  status.value ? mirrorActions(status.value, props.canManage) : null
);
/** el-alert 的红色叫 error */
const alertType = computed(() =>
  headline.value?.type === "danger" ? "error" : (headline.value?.type ?? "info")
);
const countItems = computed(() =>
  status.value ? mirrorCountItems(status.value) : []
);

const load = async () => {
  const result = await run(() => getWedriveStatus());
  if (result) status.value = result.data;
};

/** 做一个动作：成了用返回的新状态；没成重新读一遍（多半是状态已经变了）。 */
const act = async (
  action: () => Promise<ApiResult<WedriveStatus>>,
  success: string
) => {
  const result = await run(action, { success });
  if (result) status.value = result.data;
  else await load();
};

const confirmed = async (
  title: string,
  text: string,
  confirmButtonText: string
): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(text, title, {
      type: "warning",
      confirmButtonText,
      cancelButtonText: "取消"
    });
    return true;
  } catch {
    return false;
  }
};

const setup = async () => {
  const ok = await confirmed(
    "初始化微盘空间？",
    "会在企业微信的微盘里建一个叫「设备资料库」的空间，先不加任何成员，然后把现有资料镜像进去。",
    "初始化"
  );
  if (ok) await act(() => setupWedrive(), "微盘空间已建好，开始镜像");
};
const toggle = (enabled: boolean) =>
  act(
    () => saveWedriveSettings({ enabled }),
    enabled ? "镜像已开启" : "镜像已关闭"
  );
const resume = () =>
  act(() => saveWedriveSettings({ resume: true }), "已恢复，接着镜像");
const openToCompany = async () => {
  const ok = await confirmed(
    "对全公司开放？",
    "开放后，全公司的人都能在企业微信的微盘里看到『设备资料库』并下载里面的文件。",
    "开放"
  );
  if (ok) await act(() => openWedriveSpace(), "已对全公司开放");
};
const retryFailed = async () => {
  const result = await run(() => retryFailedMirrors());
  if (result) {
    message(`已重新排上 ${result.data.requeued} 份`, { type: "success" });
  }
  await load();
};

onMounted(() => void load());
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template #header>
      <div class="head">
        <span>微盘镜像</span>
        <el-button link type="primary" @click="load">刷新</el-button>
      </div>
    </template>
    <template v-if="status && headline && actions">
      <el-alert
        :title="headline.text"
        :type="alertType"
        :closable="false"
        show-icon
      />
      <div class="hint">
        把设备资料库单向镜像到企业微信微盘里的「设备资料库」空间。系统里上传、改名、换归属、替换、删除资料，微盘里会跟着变；在微盘里做的改动不会回到系统，下次同步时可能被盖掉。
      </div>
      <el-descriptions
        v-if="status.initialized"
        :column="1"
        border
        size="small"
        class="facts"
      >
        <el-descriptions-item label="资料">
          <span v-for="item in countItems" :key="item.label" class="count"
            >{{ item.label }} {{ item.value }}</span
          >
        </el-descriptions-item>
        <el-descriptions-item label="本月调用次数">{{
          mirrorCallsText(status)
        }}</el-descriptions-item>
        <el-descriptions-item label="单个文件上限"
          >{{ status.mirror_max_mb }} MB，超过的不镜像</el-descriptions-item
        >
        <el-descriptions-item label="谁能看到">{{
          mirrorAudienceText(status)
        }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="props.canManage" class="actions">
        <el-button v-if="actions.setup" type="primary" @click="setup"
          >初始化微盘空间</el-button
        >
        <el-button v-if="actions.resume" type="primary" @click="resume"
          >恢复镜像</el-button
        >
        <el-button v-if="actions.retryFailed" @click="retryFailed"
          >全部重试</el-button
        >
        <el-button v-if="actions.open" @click="openToCompany"
          >对全公司开放</el-button
        >
        <el-button v-if="actions.toggle === 'on'" @click="toggle(true)"
          >开启镜像</el-button
        >
        <el-button v-if="actions.toggle === 'off'" @click="toggle(false)"
          >关闭镜像</el-button
        >
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hint {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.facts {
  max-width: 640px;
  margin-top: 12px;
}

.count {
  margin-right: 16px;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 0;
  margin-top: 16px;
}
</style>
