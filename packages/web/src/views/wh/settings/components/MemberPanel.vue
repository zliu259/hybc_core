<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { addWhMember, listWhMembers, removeWhMember } from "@/api/wh/settings";
import type { WarehouseMember } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ canManage: boolean }>();

const { wecomUsers, loadUserNames, userNameOf } = useWecomUserOptions();
const { busy, run } = useWhAction();
const members = ref<WarehouseMember[]>([]);
const picked = ref<Record<WarehouseMember["role"], string>>({
  keeper: "",
  doc_admin: ""
});

const ROLES: { role: WarehouseMember["role"]; title: string; hint: string }[] =
  [
    {
      role: "keeper",
      title: "库管",
      hint: "能入库、发货、返库、派工、确认任务、盘点"
    },
    { role: "doc_admin", title: "资料管理员", hint: "能上传和维护设备资料" }
  ];

const byRole = computed(() => ({
  keeper: members.value.filter(m => m.role === "keeper"),
  doc_admin: members.value.filter(m => m.role === "doc_admin")
}));

const load = async () => {
  const result = await run(() => listWhMembers());
  if (result) members.value = result.data;
};

const add = async (role: WarehouseMember["role"]) => {
  const userid = picked.value[role];
  if (!userid) return;
  const done = await run(() => addWhMember({ userid, role }), {
    success: "已添加"
  });
  if (done) {
    picked.value[role] = "";
    await load();
  }
};

const remove = async (member: WarehouseMember) => {
  const done = await run(() => removeWhMember(member.userid, member.role), {
    success: "已移除"
  });
  if (done) await load();
};

onMounted(async () => {
  await Promise.all([load(), loadUserNames()]);
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template #header>人员</template>
    <div v-for="item in ROLES" :key="item.role" class="role-block">
      <div class="role-title">
        {{ item.title }}<span class="role-hint">{{ item.hint }}</span>
      </div>
      <div class="role-members">
        <el-tag
          v-for="member in byRole[item.role]"
          :key="member.userid"
          :closable="props.canManage"
          @close="remove(member)"
        >
          {{ userNameOf(member.userid) }}
        </el-tag>
        <span v-if="byRole[item.role].length === 0" class="empty"
          >还没有设置</span
        >
      </div>
      <div v-if="props.canManage" class="role-add">
        <el-select
          v-model="picked[item.role]"
          filterable
          clearable
          placeholder="从通讯录选人"
          style="width: 220px"
        >
          <el-option
            v-for="user in wecomUsers"
            :key="user.userid"
            :label="user.name"
            :value="user.userid"
          />
        </el-select>
        <el-button
          type="primary"
          :disabled="!picked[item.role]"
          @click="add(item.role)"
          >添加</el-button
        >
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.role-block + .role-block {
  margin-top: 20px;
}
.role-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.role-hint {
  margin-left: 8px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.role-members {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.role-add {
  display: flex;
  gap: 8px;
}
.empty {
  color: var(--el-text-color-placeholder);
}
</style>
