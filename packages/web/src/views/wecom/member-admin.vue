<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  getWeComContacts,
  syncWeComContacts,
  type WeComDepartment,
  type WeComUser
} from "@/api/wecom";

defineOptions({
  name: "WeComMemberAdmin"
});

const loading = ref(false);
const syncing = ref(false);
const syncedAt = ref("");
const departments = ref<WeComDepartment[]>([]);
const users = ref<WeComUser[]>([]);

const keyword = ref("");
const departmentId = ref<number | null>(null);
const permissionSync = ref<{
  enriched: boolean;
  mode: "wecom_tag+fallback" | "username_fallback";
  error?: string;
} | null>(null);

const departmentMap = computed(() => {
  const map = new Map<number, string>();
  departments.value.forEach(item => {
    map.set(item.id, item.name);
  });
  return map;
});

const filteredUsers = computed(() => {
  const text = keyword.value.trim().toLowerCase();
  return users.value.filter(item => {
    const hitKeyword =
      !text ||
      item.userid.toLowerCase().includes(text) ||
      `${item.name ?? ""}`.toLowerCase().includes(text) ||
      `${item.mobile ?? ""}`.toLowerCase().includes(text) ||
      `${item.email ?? ""}`.toLowerCase().includes(text);

    const hitDepartment =
      departmentId.value == null ||
      (item.department ?? []).includes(departmentId.value);

    return hitKeyword && hitDepartment;
  });
});

const loadContacts = async () => {
  loading.value = true;
  try {
    const result = await getWeComContacts();
    syncedAt.value = result.data.syncedAt;
    departments.value = result.data.departments ?? [];
    users.value = result.data.users ?? [];
    permissionSync.value = result.data.permission_sync ?? null;
  } catch (error: unknown) {
    syncedAt.value = "";
    departments.value = [];
    users.value = [];
    permissionSync.value = null;
    const backendMsg =
      (error as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? "获取企业成员失败";
    message(backendMsg, { type: "error" });
  } finally {
    loading.value = false;
  }
};

const roleLabel = (role?: string) => {
  if (role === "super_admin") return "超级管理员";
  if (role === "finance") return "财务";
  if (role === "manager") return "经理";
  if (role === "site_manager") return "现场经理";
  if (role === "operator") return "员工";
  return "未识别";
};

const roleSourceLabel = (source?: string) => {
  if (source === "wecom_tag") return "企业微信标签";
  if (source === "username_fallback") return "账号兜底";
  return "-";
};

const syncContacts = async () => {
  syncing.value = true;
  try {
    const result = await syncWeComContacts();
    message(
      `同步完成：部门 ${result.data.departmentCount} 个，成员 ${result.data.userCount} 人`,
      { type: "success" }
    );
    await loadContacts();
  } catch (error: unknown) {
    const backendMsg =
      (error as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? "同步企业成员失败";
    message(backendMsg, { type: "error" });
  } finally {
    syncing.value = false;
  }
};

const formatDepartmentNames = (departmentIds: number[]) => {
  if (!departmentIds?.length) return "-";
  return departmentIds
    .map(id => departmentMap.value.get(id) ?? `ID:${id}`)
    .join(" / ");
};

onMounted(() => {
  void loadContacts();
});
</script>

<template>
  <el-card shadow="never" header="企业微信成员查看（管理员）">
    <el-alert
      title="页面展示企业微信已同步成员。当前已放开为所有登录用户都可手动同步。"
      type="info"
      :closable="false"
      show-icon
      class="mb-3"
    />

    <el-alert
      v-if="permissionSync"
      :title="
        permissionSync.enriched
          ? '权限识别来源：企业微信标签 + 账号兜底'
          : '权限识别来源：账号兜底（企业微信标签读取失败）'
      "
      :description="permissionSync.error || ''"
      :type="permissionSync.enriched ? 'success' : 'warning'"
      :closable="false"
      show-icon
      class="mb-3"
    />

    <div class="toolbar mb-3">
      <el-button type="primary" :loading="syncing" @click="syncContacts">
        从企业微信拉取成员
      </el-button>
      <el-tag type="info">最后同步：{{ syncedAt || "未同步" }}</el-tag>
      <el-tag type="success">部门：{{ departments.length }}</el-tag>
      <el-tag type="success">成员：{{ users.length }}</el-tag>
    </div>

    <div class="filters mb-3">
      <el-input
        v-model="keyword"
        clearable
        placeholder="按 userid/姓名/手机号/邮箱 搜索"
      />
      <el-select v-model="departmentId" clearable placeholder="按部门筛选">
        <el-option
          v-for="dept in departments"
          :key="dept.id"
          :label="dept.name"
          :value="dept.id"
        />
      </el-select>
    </div>

    <el-table :data="filteredUsers" :loading="loading" stripe height="560">
      <el-table-column prop="userid" label="userid" min-width="180" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="系统角色" width="120">
        <template #default="scope">
          <el-tag size="small" type="primary">{{
            roleLabel(scope.row.system_role)
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="识别来源" width="120">
        <template #default="scope">
          {{ roleSourceLabel(scope.row.role_source) }}
        </template>
      </el-table-column>
      <el-table-column label="部门" min-width="220">
        <template #default="scope">
          {{ formatDepartmentNames(scope.row.department || []) }}
        </template>
      </el-table-column>
      <el-table-column label="权限状况" min-width="260">
        <template #default="scope">
          <el-tag
            v-for="perm in scope.row.permissions || []"
            :key="perm"
            size="small"
            class="mr-1 mb-1"
            effect="plain"
          >
            {{ perm }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="mobile" label="手机号" width="140" />
      <el-table-column prop="email" label="邮箱" min-width="200" />
      <el-table-column label="状态" width="100">
        <template #default="scope">
          {{ scope.row.status === 1 ? "启用" : "未知" }}
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.filters {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 10px;
}

@media (max-width: 768px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
