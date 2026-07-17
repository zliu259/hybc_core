<script setup lang="ts">
import Motion from "./utils/motion";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from "vue";
import { useNav } from "@/layout/hooks/useNav";
import { useLayout } from "@/layout/hooks/useLayout";
import { bg, avatar, illustration } from "./utils/static";
import { useUserStoreHook } from "@/store/modules/user";
import { useDataThemeChange } from "@/layout/hooks/useDataThemeChange";
import { getTopMenu, initRouter } from "@/router/utils";
import { getWeComScanUrl } from "@/api/wecom";
import { setToken } from "@/utils/auth";
import {
  popRedirect,
  stashRedirectFromLoginMount
} from "@/utils/loginRedirect";
import {
  beginPasskeyAuthentication,
  finishPasskeyAuthentication
} from "@/api/passkey";
import {
  createWeComLoginPanel,
  isInWeComClient
} from "@/composables/useWeComJsSdk";

import dayIcon from "@/assets/svg/day.svg?component";
import darkIcon from "@/assets/svg/dark.svg?component";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
const passkeyLoading = ref(false);
const panelLoading = ref(false);
const panelEnabled = ref(false);
const panelElId = "wecom-login-panel";
const weComButtonSrc = "/login_white_big_2x.png";
const panelUnmount = ref<null | (() => void)>(null);
const autoRedirecting = ref(false);
const authInFlight = computed(() => loading.value || passkeyLoading.value);
const { initStorage } = useLayout();
initStorage();

const { dataTheme, overallStyle, dataThemeChange } = useDataThemeChange();
dataThemeChange(overallStyle.value);
const { title } = useNav();

const loginByCode = async (code: string) => {
  if (authInFlight.value) return;
  loading.value = true;
  try {
    const result = await useUserStoreHook().loginByWeComCode(code);
    if (!result.success) {
      message("企业微信登录失败", { type: "error" });
      return;
    }

    await initRouter();
    const target = popRedirect();
    await router.replace(target ?? getTopMenu(true).path);
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
  if (authInFlight.value) return;
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
    const begin = await beginPasskeyAuthentication();
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
    const target = popRedirect();
    await router.replace(target ?? getTopMenu(true).path);
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
  if (authInFlight.value) return;
  loading.value = true;
  try {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const inWeCom = isInWeComClient();
    const result = await getWeComScanUrl(redirectUri, {
      mode: inWeCom ? "oauth" : "scan",
      scope: "snsapi_base"
    });
    window.location.href = result.data.loginUrl;
  } catch {
    message("获取企业微信登录地址失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const initDesktopLoginPanel = async () => {
  if (isInWeComClient()) return;

  const appid = import.meta.env.VITE_WECOM_CORPID?.trim();
  const agentid = import.meta.env.VITE_WECOM_AGENT_ID?.trim();
  if (!appid || !agentid) return;

  panelLoading.value = true;
  try {
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const state = `panel_${Date.now()}`;
    const panel = await createWeComLoginPanel({
      el: `#${panelElId}`,
      appid,
      agentid,
      redirectUri,
      state,
      onLoginSuccess: code => {
        void loginByCode(code);
      },
      onLoginFail: () => {
        message("企业微信登录面板调用失败，请改用扫码登录", {
          type: "warning"
        });
      }
    });
    panelEnabled.value = true;
    panelUnmount.value = panel.unmount;
  } catch {
    panelEnabled.value = false;
  } finally {
    panelLoading.value = false;
  }
};

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  // OAuth 回跳趟不暂存，避免守卫注入的默认 redirect 覆盖深链（详见工具函数注释）
  stashRedirectFromLoginMount(code, router.currentRoute.value.query.redirect);
  if (code) {
    const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ""}`;
    window.history.replaceState({}, document.title, cleanUrl);
    void loginByCode(code);
    return;
  }

  if (isInWeComClient()) {
    autoRedirecting.value = true;
    void startWeComScan();
    return;
  }

  void initDesktopLoginPanel();
});

onBeforeUnmount(() => {
  panelUnmount.value?.();
  panelUnmount.value = null;
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
          <img src="/hybclogo.png" alt="HYBC Logo" class="login-logo" />
          <Motion>
            <h2 class="outline-hidden">{{ title }}管理系统</h2>
          </Motion>
          <Motion :delay="150">
            <el-alert
              :title="
                autoRedirecting
                  ? '正在发起企业微信自动登录...'
                  : '请使用企业微信扫码登录'
              "
              type="info"
              :closable="false"
              show-icon
            />
          </Motion>
          <Motion :delay="250">
            <button
              type="button"
              class="w-full mt-6! wecom-login-btn"
              :disabled="authInFlight"
              @click="startWeComScan"
            >
              <img
                :src="weComButtonSrc"
                alt="企业微信登录"
                class="wecom-login-btn__img"
              />
            </button>
          </Motion>
          <Motion :delay="350">
            <div class="mt-4">
              <div
                v-if="!isInWeComClient()"
                v-loading="panelLoading"
                class="panel-wrapper"
              >
                <div class="panel-title">浏览器登录（JS-SDK 面板）</div>
                <div :id="panelElId" class="panel-box" />
                <div v-if="!panelEnabled" class="panel-tip">
                  未检测到可用登录面板，请使用上方扫码登录
                </div>
              </div>
              <el-button
                class="w-full mt-3!"
                :loading="passkeyLoading"
                :disabled="authInFlight"
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

.panel-wrapper {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px dashed rgb(47 108 95 / 35%);
  border-radius: 8px;
  background: #fffaf2;
}

.panel-title {
  margin-bottom: 8px;
  font-size: 12px;
  color: #6e6458;
}

.panel-box {
  min-height: 100px;
}

.panel-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #8f8477;
}

.wecom-login-btn {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.wecom-login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wecom-login-btn__img {
  display: block;
  width: 100%;
  height: auto;
}

.login-logo {
  width: 80px;
  margin-bottom: 20px;
}
</style>
