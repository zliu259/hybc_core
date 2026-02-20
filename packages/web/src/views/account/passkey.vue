<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  listPasskeyCredentials,
  revokePasskeyCredential,
  type PasskeyCredentialRow
} from "@/api/passkey";

defineOptions({
  name: "PasskeyManagement"
});

const loading = ref(false);
const enrolling = ref(false);
const list = ref<PasskeyCredentialRow[]>([]);

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

const load = async () => {
  loading.value = true;
  try {
    const res = await listPasskeyCredentials();
    list.value = res.data;
  } catch {
    list.value = [];
  } finally {
    loading.value = false;
  }
};

const enroll = async () => {
  if (
    !("credentials" in navigator) ||
    typeof window.PublicKeyCredential === "undefined" ||
    !window.isSecureContext
  ) {
    message(getPasskeyUnsupportedReason(), { type: "warning" });
    return;
  }

  enrolling.value = true;
  try {
    const begin = await beginPasskeyRegistration();
    const options = begin.data.options as Record<string, any>;
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: base64UrlToBuffer(options.challenge),
        rp: options.rp,
        user: {
          ...options.user,
          id: new TextEncoder().encode(String(options.user?.id || ""))
        },
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation,
        authenticatorSelection: options.authenticatorSelection,
        excludeCredentials: Array.isArray(options.excludeCredentials)
          ? options.excludeCredentials.map(item => ({
              id: base64UrlToBuffer(item.id),
              type: item.type
            }))
          : []
      }
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      message("Passkey 注册已取消", { type: "warning" });
      return;
    }

    const credentialId = bytesToBase64Url(new Uint8Array(credential.rawId));
    await finishPasskeyRegistration({
      challengeId: begin.data.challengeId,
      credentialId,
      publicKey: credentialId,
      counter: 0,
      transports: ["internal"],
      deviceType: "singleDevice",
      backedUp: false
    });

    message("Passkey 注册成功", { type: "success" });
    await load();
  } catch (error: any) {
    const msg =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      "Passkey 注册失败";
    message(msg, { type: "error" });
  } finally {
    enrolling.value = false;
  }
};

const revoke = async (credentialId: string) => {
  try {
    await revokePasskeyCredential(credentialId);
    message("Passkey 已吊销", { type: "success" });
    await load();
  } catch (error: any) {
    const msg =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      "Passkey 吊销失败";
    message(msg, { type: "error" });
  }
};

onMounted(load);
</script>

<template>
  <el-card shadow="never" header="Passkey 管理">
    <el-alert
      title="首次绑定需先完成企业微信登录。绑定后可在支持 WebAuthn 的浏览器中使用 Passkey 登录。"
      type="info"
      :closable="false"
      show-icon
    />
    <el-button class="mt-3" type="primary" :loading="enrolling" @click="enroll">
      注册新 Passkey
    </el-button>
    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column label="凭证ID" min-width="240">
        <template #default="scope">
          {{ scope.row.credentialId }}
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="createdAt" label="创建时间" width="200" />
      <el-table-column prop="lastUsedAt" label="最近使用" width="200" />
      <el-table-column label="操作" width="100">
        <template #default="scope">
          <el-button link type="danger" @click="revoke(scope.row.credentialId)">
            吊销
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
