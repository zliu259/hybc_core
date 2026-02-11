<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { getWeComContacts, syncWeComContacts } from "@/api/wecom";

defineOptions({
  name: "WeComContacts"
});

const syncing = ref(false);
const loading = ref(false);
const syncedAt = ref("");
const departments = ref<Array<{ id: number; name: string; parentid: number }>>([]);
const users = ref<Array<{ userid: string; name: string; department: number[] }>>([]);

const loadContacts = async () => {
  loading.value = true;
  try {
    const result = await getWeComContacts();
    syncedAt.value = result.data.syncedAt;
    departments.value = result.data.departments;
    users.value = result.data.users;
  } catch {
    syncedAt.value = "";
    departments.value = [];
    users.value = [];
  } finally {
    loading.value = false;
  }
};

const syncContacts = async () => {
  syncing.value = true;
  try {
    const result = await syncWeComContacts();
    message(
      `同步完成: 部门 ${result.data.departmentCount} 个, 成员 ${result.data.userCount} 人`,
      { type: "success" }
    );
    await loadContacts();
  } catch {
    message("同步企业微信通讯录失败", { type: "error" });
  } finally {
    syncing.value = false;
  }
};

onMounted(loadContacts);
</script>

<template>
  <el-card shadow="never" header="企业微信通讯录">
    <div class="mb-3">
      <el-button type="primary" :loading="syncing" @click="syncContacts">
        同步通讯录
      </el-button>
      <el-tag class="ml-3" type="info">最后同步: {{ syncedAt || "未同步" }}</el-tag>
    </div>

    <el-row :gutter="16">
      <el-col :md="8" :xs="24">
        <el-card shadow="never" header="部门列表">
          <el-table :data="departments" :loading="loading" height="420">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="部门" />
            <el-table-column prop="parentid" label="上级" width="80" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="16" :xs="24">
        <el-card shadow="never" header="成员列表">
          <el-table :data="users" :loading="loading" height="420">
            <el-table-column prop="userid" label="userid" width="220" />
            <el-table-column prop="name" label="姓名" width="140" />
            <el-table-column label="部门ID列表">
              <template #default="scope">
                {{ (scope.row.department || []).join(", ") }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </el-card>
</template>
