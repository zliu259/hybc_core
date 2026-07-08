<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  Link,
  Lock,
  Monitor,
  Refresh,
  SwitchButton
} from "@element-plus/icons-vue";
import { createVertexHandoff, type VertexHandoffResult } from "@/api/vertex";
import { useUserStoreHook } from "@/store/modules/user";
import { getToken } from "@/utils/auth";
import { message } from "@/utils/message";

defineOptions({ name: "AdminVertexBridge" });

const savedBaseUrlKey = "hybc:vertex:base-url";
const defaultVertexPort = "8788";

const loading = ref(false);
const opening = ref(false);
const vertexBaseUrl = ref("");
const entryPath = ref("/");
const lastHandoff = ref<VertexHandoffResult["data"] | null>(null);
const userStore = useUserStoreHook();

const configuredBaseUrl = computed(
  () => import.meta.env.VITE_VERTEX_BASE_URL?.trim() || ""
);
const tokenInfo = computed(() => getToken());
const loggedIn = computed(() => Boolean(tokenInfo.value?.accessToken));

const isPrivateIpv4 = (host: string): boolean => {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
};

const inferVertexBaseUrl = (): string => {
  const saved = window.localStorage.getItem(savedBaseUrlKey)?.trim();
  if (saved) return saved;
  if (configuredBaseUrl.value) return configuredBaseUrl.value;

  const { protocol, hostname } = window.location;
  const hostForUrl = hostname.includes(":") ? `[${hostname}]` : hostname;
  if (hostname.endsWith("hybcdg.com")) {
    return "https://vertex.hybcdg.com";
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `http://${hostForUrl}:${defaultVertexPort}`;
  }
  if (isPrivateIpv4(hostname) || hostname.includes(":")) {
    return `${protocol}//${hostForUrl}:${defaultVertexPort}`;
  }
  return "https://vertex.hybcdg.com";
};

vertexBaseUrl.value = inferVertexBaseUrl();

const hybcApiBaseUrl = computed(() => {
  return (
    import.meta.env.VITE_API_BASE_URL?.trim() ||
    import.meta.env.VITE_API_TARGET?.trim() ||
    window.location.origin
  );
});

const rolesText = computed(() => {
  return userStore.roles.length ? userStore.roles.join(", ") : "-";
});

const scopesText = computed(() => {
  return lastHandoff.value?.scopes?.length
    ? lastHandoff.value.scopes.join(", ")
    : "-";
});

const saveBaseUrl = () => {
  const value = vertexBaseUrl.value.trim();
  if (!value) {
    window.localStorage.removeItem(savedBaseUrlKey);
    vertexBaseUrl.value = inferVertexBaseUrl();
    message("已恢复默认 Vertex 地址", { type: "success" });
    return;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    window.localStorage.setItem(
      savedBaseUrlKey,
      url.toString().replace(/\/$/, "")
    );
    vertexBaseUrl.value = url.toString().replace(/\/$/, "");
    message("Vertex 地址已保存到本机浏览器", { type: "success" });
  } catch {
    message("请填写有效的 http(s) Vertex 地址", { type: "warning" });
  }
};

const requestHandoff = async () => {
  if (!loggedIn.value) {
    message("当前未登录，请先完成 HYBC 登录", { type: "warning" });
    return null;
  }

  loading.value = true;
  try {
    const result = await createVertexHandoff({
      vertexBaseUrl: vertexBaseUrl.value.trim(),
      hybcApiBaseUrl: hybcApiBaseUrl.value,
      entryPath: entryPath.value.trim() || "/"
    });
    lastHandoff.value = result.data;
    return result.data;
  } catch {
    message("Vertex 授权签发失败，请确认当前账号具备现场控制权限", {
      type: "error"
    });
    return null;
  } finally {
    loading.value = false;
  }
};

const openVertex = async () => {
  opening.value = true;
  try {
    const handoff = await requestHandoff();
    if (!handoff?.launch_url) return;
    window.open(handoff.launch_url, "_blank", "noopener,noreferrer");
    message("Vertex 控制区已打开", { type: "success" });
  } finally {
    opening.value = false;
  }
};

// Mac 控制台等外部工具经 ?auto=vertex 进入时：自动签发授权并在当前标签页
// 跳转 Vertex（同页跳转不需要用户手势，不会被弹窗拦截）。未登录时守卫已在
// 到达本页前跳去登录，因此这里仅处理已登录场景。
const route = useRoute();

const autoOpenVertex = async () => {
  opening.value = true;
  try {
    const handoff = await requestHandoff();
    if (!handoff?.launch_url) return;
    message("授权已签发，正在进入 Vertex…", { type: "success" });
    window.location.href = handoff.launch_url;
  } finally {
    opening.value = false;
  }
};

onMounted(() => {
  if (route.query.auto === "vertex" && loggedIn.value) {
    void autoOpenVertex();
  }
});

const refreshHandoff = async () => {
  const handoff = await requestHandoff();
  if (handoff) {
    message("Vertex 授权已刷新", { type: "success" });
  }
};
</script>

<template>
  <div class="vertex-bridge">
    <section class="vertex-bridge__header">
      <div>
        <div class="vertex-bridge__eyebrow">HYBC Vertex</div>
        <h1>现场 Vertex 控制区</h1>
        <p>从主系统签发短时授权，跳转到同网或云端 Vertex 控制页面。</p>
      </div>
      <el-button
        type="primary"
        size="large"
        :icon="SwitchButton"
        :loading="opening"
        @click="openVertex"
      >
        打开 Vertex
      </el-button>
    </section>

    <section class="vertex-bridge__grid">
      <el-card shadow="never" class="vertex-panel">
        <template #header>
          <div class="vertex-panel__title">
            <el-icon><Monitor /></el-icon>
            <span>连接目标</span>
          </div>
        </template>

        <el-form label-position="top">
          <el-form-item label="Vertex 地址">
            <el-input
              v-model="vertexBaseUrl"
              placeholder="https://vertex.hybcdg.com"
              clearable
            />
          </el-form-item>
          <el-form-item label="入口路径">
            <el-input v-model="entryPath" placeholder="/" />
          </el-form-item>
          <el-form-item label="HYBC 主 worker">
            <el-input :model-value="hybcApiBaseUrl" disabled />
          </el-form-item>
        </el-form>

        <div class="vertex-panel__actions">
          <el-button :icon="Link" @click="saveBaseUrl">保存地址</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="refreshHandoff">
            预签发授权
          </el-button>
        </div>
      </el-card>

      <el-card shadow="never" class="vertex-panel">
        <template #header>
          <div class="vertex-panel__title">
            <el-icon><Lock /></el-icon>
            <span>授权状态</span>
          </div>
        </template>

        <el-descriptions :column="1" border>
          <el-descriptions-item label="HYBC 登录">
            <el-tag :type="loggedIn ? 'success' : 'danger'" size="small">
              {{ loggedIn ? "已登录" : "未登录" }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="当前角色">
            {{ rolesText }}
          </el-descriptions-item>
          <el-descriptions-item label="Vertex 权限">
            {{ scopesText }}
          </el-descriptions-item>
          <el-descriptions-item label="授权有效期">
            {{ lastHandoff?.expires_at || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="目标地址">
            {{ lastHandoff?.vertex_base_url || vertexBaseUrl || "-" }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </section>
  </div>
</template>

<style scoped>
.vertex-bridge {
  min-height: calc(100vh - 96px);
  padding: 24px;
  background: #f6f8fb;
}

.vertex-bridge__header {
  display: flex;
  gap: 24px;
  align-items: center;
  justify-content: space-between;
  padding: 24px 0;
}

.vertex-bridge__eyebrow {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 700;
  color: #0f766e;
  text-transform: uppercase;
}

.vertex-bridge__header h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.25;
  color: #111827;
}

.vertex-bridge__header p {
  max-width: 640px;
  margin: 8px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: #5b6472;
}

.vertex-bridge__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.8fr);
  gap: 16px;
}

.vertex-panel {
  border-radius: 8px;
}

.vertex-panel__title,
.vertex-panel__actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.vertex-panel__title {
  font-weight: 700;
  color: #111827;
}

.vertex-panel__actions {
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .vertex-bridge {
    padding: 16px;
  }

  .vertex-bridge__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .vertex-bridge__grid {
    grid-template-columns: 1fr;
  }

  .vertex-panel__actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
