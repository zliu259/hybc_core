<script setup lang="ts">
import { ref } from "vue";

import { listDevices } from "@/api/wh/device";
import type { DeviceRow, DeviceState } from "@/api/wh/types";

const props = defineProps<{ state?: DeviceState; excludeIds: number[] }>();
const emit = defineEmits<{ pick: [device: DeviceRow] }>();

const options = ref<DeviceRow[]>([]);
const loading = ref(false);
const value = ref<number | undefined>();

const search = async (keyword: string) => {
  loading.value = true;
  try {
    const result = await listDevices({
      state: props.state,
      keyword: keyword || undefined,
      pageSize: 30
    });
    options.value = result.data.filter(
      device => !props.excludeIds.includes(device.id)
    );
  } catch {
    options.value = [];
  } finally {
    loading.value = false;
  }
};

const onPick = (id: number) => {
  const device = options.value.find(item => item.id === id);
  if (device) emit("pick", device);
  value.value = undefined;
};
</script>

<template>
  <el-select
    v-model="value"
    filterable
    remote
    :remote-method="search"
    :loading="loading"
    placeholder="搜索设备编号或名称后选择"
    style="width: 320px"
    @focus="search('')"
    @change="onPick"
  >
    <el-option
      v-for="d in options"
      :key="d.id"
      :label="`${d.device_code} ${d.name}`"
      :value="d.id"
    />
  </el-select>
</template>
