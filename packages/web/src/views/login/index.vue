<script setup lang="ts">
import Motion from "./utils/motion";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { onMounted, ref, toRaw } from "vue";
import { useNav } from "@/layout/hooks/useNav";
import { useLayout } from "@/layout/hooks/useLayout";
import { bg, avatar, illustration } from "./utils/static";
import { useUserStoreHook } from "@/store/modules/user";
import { useDataThemeChange } from "@/layout/hooks/useDataThemeChange";
import { getTopMenu, initRouter } from "@/router/utils";
import { getWeComScanUrl } from "@/api/wecom";
import { setToken } from "@/utils/auth";
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication
} from "@/api/passkey";

import dayIcon from "@/assets/svg/day.svg?component";
import darkIcon from "@/assets/svg/dark.svg?component";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
const passkeyLoading = ref(false);
const passkeyUserId = ref("");
const { initStorage } = useLayout();
initStorage();

const { dataTheme, overallStyle, dataThemeChange } = useDataThemeChange();
dataThemeChange(overallStyle.value);
const { title } = useNav();

const loginByCode = async (code: string) => {
  loading.value = true;
  try {
    const result = await useUserStoreHook().loginByWeComCode(code);
    if (!result.success) {
      message("企业微信登录失败", { type: "error" });
      return;
    }

    await initRouter();
    const top = getTopMenu(true);
    await router.replace(top.path);
    message("登录成功", { type: "success" });
  } catch (error: any) {
    const backendMsg =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      "企业微信登录失败";
    message(backendMsg, { type: "error" });
  } finally {
    loading.value = false;
  }
};

const base64UrlToBuffer = (input: string): ArrayBuffer => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const base64 = `${normalized}${padding ? "=".repeat(4 - padding) : ""}`;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer.slice(0);
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const getPasskeyUnsupportedReason = (): string => {
  if (!window.isSecureContext) {
    return "当前页面不是安全上下文（需要 HTTPS 或 localhost）";
  }
  if (typeof window.PublicKeyCredential === "undefined") {
    return "当前运行环境不支持 WebAuthn（常见于企业微信内置 WebView）";
  }
  if (!("credentials" in navigator)) {
    return "浏览器未提供 Credential Management API";
  }
  return "当前浏览器不支持 Passkey";
};

const parseAuthOptions = (options: Record<string, any>) => {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification ?? "preferred",
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map(item => ({
          id: base64UrlToBuffer(item.id),
          type: item.type,
          transports: item.transports
        }))
      : []
  };
};

const loginByPasskey = async () => {
  if (!passkeyUserId.value.trim()) {
    message("请先输入用户ID（企业微信userid）", { type: "warning" });
    return;
  }

  if (
    !("credentials" in navigator) ||
    typeof window.PublicKeyCredential === "undefined" ||
    !window.isSecureContext
  ) {
    message(`${getPasskeyUnsupportedReason()}，请使用企业微信扫码登录`, {
      type: "warning"
    });
    return;
  }

  passkeyLoading.value = true;
  try {
    const begin = await beginPasskeyAuthentication(passkeyUserId.value.trim());
    const options = parseAuthOptions(begin.data.options as Record<string, any>);
    const assertion = (await navigator.credentials.get({
      publicKey: options
    })) as PublicKeyCredential | null;

    if (!assertion || !assertion.rawId) {
      message("Passkey 验证已取消", { type: "warning" });
      return;
    }

    const credentialId = bytesToBase64Url(new Uint8Array(assertion.rawId));
    const finish = await finishPasskeyAuthentication({
      challengeId: begin.data.challengeId,
      userId: passkeyUserId.value.trim(),
      credentialId,
      counter: Date.now()
    });

    if (!finish.success) {
      message("Passkey 登录失败", { type: "error" });
      return;
    }

    useUserStoreHook().SET_ISREMEMBERED(true);
    useUserStoreHook().loginDay = 7;
    setToken(finish.data);
    await initRouter();
    const top = getTopMenu(true);
    await router.replace(top.path);
    message("Passkey 登录成功", { type: "success" });
  } catch (error: any) {
    const backendMsg =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      "Passkey 登录失败";
    message(backendMsg, { type: "error" });
  } finally {
    passkeyLoading.value = false;
  }
};

const startWeComScan = async () => {
  loading.value = true;
  try {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const result = await getWeComScanUrl(redirectUri);
    window.location.href = result.data.scanUrl;
  } catch {
    message("获取企业微信扫码地址失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState({}, document.title, cleanUrl);
    void loginByCode(code);
  }
});
</script>

<template>
  <div class="select-none">
    <img :src="bg" class="wave" />
    <div class="flex-c absolute right-5 top-3">
      <el-switch
        v-model="dataTheme"
        inline-prompt
        :active-icon="dayIcon"
        :inactive-icon="darkIcon"
        @change="dataThemeChange"
      />
    </div>
    <div class="login-container">
      <div class="img">
        <component :is="toRaw(illustration)" />
      </div>
      <div class="login-box">
        <div class="login-form">
          <avatar class="avatar" />
          <Motion>
            <h2 class="outline-hidden">{{ title }}</h2>
          </Motion>
          <Motion :delay="150">
            <el-alert
              title="请使用企业微信扫码登录"
              type="info"
              :closable="false"
              show-icon
            />
          </Motion>
          <Motion :delay="250">
            <el-button
              class="w-full mt-6!"
              type="primary"
              :loading="loading"
              @click="startWeComScan"
            >
              企业微信扫码登录
            </el-button>
          </Motion>
          <Motion :delay="350">
            <div class="mt-4">
              <el-input
                v-model="passkeyUserId"
                placeholder="输入企业微信userid后使用Passkey"
                clearable
              />
              <el-button
                class="w-full mt-3!"
                :loading="passkeyLoading"
                @click="loginByPasskey"
              >
                使用 Passkey 登录
              </el-button>
            </div>
          </Motion>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url("@/style/login.css");
</style>
