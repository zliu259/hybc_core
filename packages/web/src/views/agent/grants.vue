<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import {
  adminListAgentGrants,
  adminRevokeAgentGrant,
  listMyAgentGrants,
  revokeMyAgentGrant,
  type AdminAgentGrant,
  type AgentGrant
} from "@/api/agent";

defineOptions({ name: "AgentGrants" });

const userStore = useUserStoreHook();
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const viewAll = ref(false);
const loading = ref(false);
const acting = ref(false);
const list = ref<Array<AgentGrant | AdminAgentGrant>>([]);

const STATUS_LABELS: Record<AgentGrant["status"], string> = {
  active: "有效",
  revoked: "已吊销",
  expired: "已过期"
};
const STATUS_TYPES: Record<
  AgentGrant["status"],
  "success" | "danger" | "info"
> = {
  active: "success",
  revoked: "danger",
  expired: "info"
};

const formatTime = (value: string | null) => {
  if (!value) return "—";
  return value
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "")
    .slice(0, 16);
};

const ownerOf = (row: AgentGrant | AdminAgentGrant) =>
  "wecom_userid" in row ? row.wecom_userid : "";

const loadData = async () => {
  loading.value = true;
  try {
    const res = viewAll.value
      ? await adminListAgentGrants()
      : await listMyAgentGrants();
    list.value = res.data;
  } catch {
    message("加载授权列表失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const onToggleViewAll = async () => {
  await loadData();
};

const onRevoke = async (row: AgentGrant | AdminAgentGrant) => {
  const label = row.device_name || row.token_prefix || row.id.slice(0, 8);
  try {
    await ElMessageBox.confirm(
      `确认吊销「${label}」的访问授权吗？该设备上的 AI 助手将立即失去访问权限。`,
      "吊销授权",
      { type: "warning" }
    );
  } catch {
    return;
  }
  acting.value = true;
  try {
    if (viewAll.value) {
      await adminRevokeAgentGrant(row.id);
    } else {
      await revokeMyAgentGrant(row.id);
    }
    message("已吊销", { type: "success" });
    await loadData();
  } catch {
    message("吊销失败", { type: "error" });
  } finally {
    acting.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
          "
        >
          <span style="font-weight: 600">设备授权</span>
          <el-switch
            v-if="isSuperAdmin"
            v-model="viewAll"
            active-text="查看全部员工"
            inactive-text="仅本人"
            @change="onToggleViewAll"
          />
        </div>
      </template>

      <el-table v-loading="loading" :data="list" size="default">
        <template #empty>
          <el-empty
            description="暂无授权设备。到「接入配置」页生成安装命令即可接入。"
          />
        </template>
        <el-table-column v-if="viewAll" label="员工" width="120">
          <template #default="scope">{{ ownerOf(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="设备" min-width="140">
          <template #default="scope">
            {{ scope.row.device_name || "未命名设备" }}
          </template>
        </el-table-column>
        <el-table-column prop="agent_type" label="Agent" width="130">
          <template #default="scope">{{
            scope.row.agent_type || "—"
          }}</template>
        </el-table-column>
        <el-table-column prop="token_prefix" label="令牌前缀" width="170">
          <template #default="scope">
            <code>{{ scope.row.token_prefix || "—" }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="STATUS_TYPES[scope.row.status]" size="small">
              {{ STATUS_LABELS[scope.row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="150">
          <template #default="scope">{{
            formatTime(scope.row.created_at)
          }}</template>
        </el-table-column>
        <el-table-column label="到期时间" width="150">
          <template #default="scope">{{
            formatTime(scope.row.expires_at)
          }}</template>
        </el-table-column>
        <el-table-column label="最近使用" width="150">
          <template #default="scope">{{
            formatTime(scope.row.last_used_at)
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="scope">
            <el-button
              v-if="scope.row.status === 'active'"
              link
              type="danger"
              :disabled="acting"
              @click="onRevoke(scope.row)"
            >
              吊销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
