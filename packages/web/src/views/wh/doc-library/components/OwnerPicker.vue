<script setup lang="ts">
import { ref, watch } from "vue";

import { listDevices } from "@/api/wh/device";
import type { DocScope } from "@/api/wh/doc-library-types";
import type { DeviceCategory } from "@/api/wh/types";
import type { DocOwner } from "../doc-view";

interface DeviceOption {
  id: number;
  label: string;
}

const props = defineProps<{
  categories: DeviceCategory[];
  /** 已经选中的设备叫什么（改资料时用，免得下拉框里只显示数字） */
  deviceLabel?: string | null;
}>();
const owner = defineModel<DocOwner>({ required: true });

const options = ref<DeviceOption[]>([]);
const searching = ref(false);
let searchSeq = 0;

const search = async (keyword: string) => {
  searchSeq += 1;
  const seq = searchSeq;
  searching.value = true;
  try {
    const result = await listDevices({
      keyword: keyword.trim() || undefined,
      pageSize: 20
    });
    if (seq !== searchSeq) return;
    options.value = result.data.map(device => ({
      id: device.id,
      label: [device.device_code, device.name, device.alias]
        .filter(Boolean)
        .join(" ")
    }));
  } catch (error) {
    console.error("[doc-library] 搜索设备失败", error);
    if (seq === searchSeq) options.value = [];
  } finally {
    if (seq === searchSeq) searching.value = false;
  }
};

// 已选中的设备不在这次搜索结果里时补进去，下拉框才显示得出名字
watch(
  () => [owner.value.deviceId, props.deviceLabel] as const,
  ([deviceId, label]) => {
    if (deviceId === null || !label) return;
    if (options.value.some(option => option.id === deviceId)) return;
    options.value = [{ id: deviceId, label }, ...options.value];
  },
  { immediate: true }
);

const setKind = (kind: DocScope) => {
  owner.value = { ...owner.value, kind };
};
const setDevice = (deviceId: number | null | undefined) => {
  owner.value = { ...owner.value, deviceId: deviceId ?? null };
};
const setCategory = (categoryId: number | null | undefined) => {
  owner.value = { ...owner.value, categoryId: categoryId ?? null };
};
</script>

<template>
  <div class="owner">
    <el-radio-group
      :model-value="owner.kind"
      @update:model-value="value => setKind(value as DocScope)"
    >
      <el-radio value="device">某台设备</el-radio>
      <el-radio value="category">某类设备</el-radio>
      <el-radio value="general">通用</el-radio>
    </el-radio-group>
    <el-select
      v-if="owner.kind === 'device'"
      :model-value="owner.deviceId ?? undefined"
      filterable
      remote
      clearable
      :remote-method="search"
      :loading="searching"
      placeholder="输入编号、名称或现场叫法搜索"
      style="width: 100%"
      @focus="options.length <= 1 && search('')"
      @update:model-value="setDevice"
    >
      <el-option
        v-for="option in options"
        :key="option.id"
        :label="option.label"
        :value="option.id"
      />
    </el-select>
    <el-select
      v-else-if="owner.kind === 'category'"
      :model-value="owner.categoryId ?? undefined"
      clearable
      placeholder="选择设备类别"
      style="width: 100%"
      @update:model-value="setCategory"
    >
      <el-option
        v-for="category in props.categories.filter(
          item => item.status === 'active' || item.id === owner.categoryId
        )"
        :key="category.id"
        :label="category.name"
        :value="category.id"
      />
    </el-select>
    <div v-else class="hint">所有设备都适用，比如通用的安全规程。</div>
  </div>
</template>

<style scoped>
.owner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
