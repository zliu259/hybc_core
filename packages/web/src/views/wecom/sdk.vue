<script setup lang="ts">
import { ref } from "vue";
import { message } from "@/utils/message";
import { storageLocal } from "@pureadmin/utils";
import { userKey, type DataInfo } from "@/utils/auth";
import { initWeComJsSdk, isInWeComClient } from "@/composables/useWeComJsSdk";

defineOptions({
  name: "WeComSdk"
});

type WeComInvoker = {
  mode: "ww" | "wx";
  invoke: (
    api: string,
    payload?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
};

const JS_API_LIST = [
  "getContext",
  "scanQRCode",
  "selectEnterpriseContact",
  "openEnterpriseChat",
  "getLocation",
  "chooseImage",
  "previewImage",
  "previewFile",
  "openUserProfile",
  "hideMenuItems",
  "showMenuItems",
  "closeWindow"
];

const sdkLoading = ref(false);
const actionLoading = ref(false);
const sdkMode = ref<"ww" | "wx" | "">("");
const sdkReady = ref(false);
const result = ref("");
const invoker = ref<WeComInvoker | null>(null);

const showResult = (label: string, payload: unknown) => {
  result.value = `[${label}]\n${JSON.stringify(payload, null, 2)}`;
};

const ensureSdkReady = async () => {
  if (invoker.value) return invoker.value;

  sdkLoading.value = true;
  try {
    const client = await initWeComJsSdk(JS_API_LIST);
    sdkMode.value = client.mode;
    sdkReady.value = true;
    invoker.value = client;
    showResult("初始化成功", { mode: client.mode });
    return client;
  } finally {
    sdkLoading.value = false;
  }
};

const runApi = async (
  label: string,
  api: string,
  payload: Record<string, unknown> = {}
) => {
  actionLoading.value = true;
  try {
    const client = await ensureSdkReady();
    const data = await client.invoke(api, payload);
    showResult(label, data);
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : `${error}`;
    showResult(label, { error: messageText });
    message(`${label} 调用失败`, { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const callGetContext = () => runApi("获取上下文", "getContext");
const callScan = () => runApi("扫码", "scanQRCode", { needResult: 1 });
const callSelectContact = () =>
  runApi("选择企业成员", "selectEnterpriseContact", {
    mode: "single",
    type: ["user"],
    selectedUserIds: []
  });
const callOpenChat = () =>
  runApi("打开会话", "openEnterpriseChat", {
    userIds: [],
    groupName: "HYBC 协同会话"
  });
const callLocation = () => runApi("获取位置", "getLocation");
const callChooseImage = () =>
  runApi("选择图片", "chooseImage", {
    count: 1,
    sourceType: ["album", "camera"]
  });
const callPreviewImage = () =>
  runApi("预览图片", "previewImage", {
    current: "https://via.placeholder.com/600x400.png?text=HYBC",
    urls: ["https://via.placeholder.com/600x400.png?text=HYBC"]
  });
const callPreviewFile = () =>
  runApi("预览文件", "previewFile", {
    url: "https://example.com/demo.pdf",
    name: "demo.pdf",
    size: 1024
  });
const callOpenUserProfile = () => {
  const username =
    storageLocal().getItem<DataInfo<number>>(userKey)?.username ?? "";
  if (!username) {
    message("当前用户缺少 userid 信息", { type: "warning" });
    return;
  }
  void runApi("打开用户资料", "openUserProfile", { userid: username });
};
const callHideMenu = () =>
  runApi("隐藏右上角菜单", "hideMenuItems", { menuList: ["menuItem:copyUrl"] });
const callShowMenu = () =>
  runApi("恢复右上角菜单", "showMenuItems", { menuList: ["menuItem:copyUrl"] });
const callCloseWindow = () => runApi("关闭当前窗口", "closeWindow");
</script>

<template>
  <el-card shadow="never" header="企业微信 JS-SDK 能力台">
    <el-alert
      :title="
        isInWeComClient()
          ? '当前在企业微信容器内，可直接调试 JS-SDK'
          : '当前不在企业微信容器，部分 API 会失败（可先验证初始化）'
      "
      type="info"
      :closable="false"
      show-icon
      class="mb-3"
    />
    <div class="toolbar">
      <el-button type="primary" :loading="sdkLoading" @click="ensureSdkReady">
        初始化 SDK
      </el-button>
      <el-tag type="success"
        >状态: {{ sdkReady ? `已初始化(${sdkMode})` : "未初始化" }}</el-tag
      >
    </div>

    <div v-loading="actionLoading" class="actions">
      <el-button @click="callGetContext">getContext</el-button>
      <el-button @click="callScan">scanQRCode</el-button>
      <el-button @click="callSelectContact">selectEnterpriseContact</el-button>
      <el-button @click="callOpenChat">openEnterpriseChat</el-button>
      <el-button @click="callLocation">getLocation</el-button>
      <el-button @click="callChooseImage">chooseImage</el-button>
      <el-button @click="callPreviewImage">previewImage</el-button>
      <el-button @click="callPreviewFile">previewFile</el-button>
      <el-button @click="callOpenUserProfile">openUserProfile</el-button>
      <el-button @click="callHideMenu">hideMenuItems</el-button>
      <el-button @click="callShowMenu">showMenuItems</el-button>
      <el-button type="danger" plain @click="callCloseWindow"
        >closeWindow</el-button
      >
    </div>

    <el-input
      v-model="result"
      type="textarea"
      :rows="14"
      readonly
      placeholder="调用结果将在此显示"
    />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}
</style>
