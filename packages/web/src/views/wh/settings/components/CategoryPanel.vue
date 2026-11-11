<script setup lang="ts">
import { onMounted, ref } from "vue";

import {
  createDeviceCategory,
  listDeviceCategories,
  updateDeviceCategory
} from "@/api/wh/settings";
import type { DeviceCategory } from "@/api/wh/types";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ canEdit: boolean }>();

const { busy, run } = useWhAction();
const categories = ref<DeviceCategory[]>([]);
const newName = ref("");

const load = async () => {
  const result = await run(() => listDeviceCategories());
  if (result) categories.value = result.data;
};

const add = async () => {
  const name = newName.value.trim();
  if (!name) return;
  const sortOrder = (categories.value.at(-1)?.sort_order ?? 0) + 1;
  const done = await run(
    () => createDeviceCategory({ name, sort_order: sortOrder }),
    { success: "已添加" }
  );
  if (done) {
    newName.value = "";
    await load();
  }
};

const save = async (
  row: DeviceCategory,
  patch: Partial<Pick<DeviceCategory, "name" | "sort_order" | "status">>
) => {
  const done = await run(() => updateDeviceCategory(row.id, patch), {
    success: "已保存"
  });
  await load();
  return done;
};
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template #header>设备类别</template>
    <el-table :data="categories" size="small" empty-text="还没有设备类别">
      <el-table-column label="名称" min-width="160">
        <template #default="{ row }">
          <el-input
            v-if="props.canEdit"
            :model-value="row.name"
            maxlength="30"
            @change="value => save(row, { name: String(value) })"
          />
          <span v-else>{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="排序" width="130">
        <template #default="{ row }">
          <el-input-number
            v-if="props.canEdit"
            :model-value="row.sort_order"
            :min="0"
            :max="9999"
            size="small"
            @change="value => save(row, { sort_order: Number(value ?? 0) })"
          />
          <span v-else>{{ row.sort_order }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            :disabled="!props.canEdit"
            active-text="启用"
            @change="
              value => save(row, { status: value ? 'active' : 'disabled' })
            "
          />
        </template>
      </el-table-column>
    </el-table>
    <div v-if="props.canEdit" class="add-row">
      <el-input
        v-model="newName"
        maxlength="30"
        placeholder="新类别，如 顶管机、油泵站、发电机"
        style="width: 280px"
        @keyup.enter="add"
      />
      <el-button type="primary" :disabled="!newName.trim()" @click="add"
        >添加类别</el-button
      >
    </div>
  </el-card>
</template>

<style scoped>
.add-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
