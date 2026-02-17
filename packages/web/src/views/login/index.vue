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

import dayIcon from "@/assets/svg/day.svg?component";
import darkIcon from "@/assets/svg/dark.svg?component";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
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
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url("@/style/login.css");
</style>
