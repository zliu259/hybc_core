<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { getDevice, unscrapDevice } from "@/api/wh/device";
import { listDeviceCategories } from "@/api/wh/settings";
import { listTasks } from "@/api/wh/task";
import type { DeviceCategory, DeviceDetail, TaskRow } from "@/api/wh/types";
import { DEVICE_STATE_TAG, TASK_KIND_LABELS } from "../shared/labels";
import { newClientRequestId } from "../shared/ids";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import DeviceDocsCard from "../doc-library/components/DeviceDocsCard.vue";
import DeviceFormDialog from "./components/DeviceFormDialog.vue";
import DeviceTimeline from "./components/DeviceTimeline.vue";
import DeviceUsagePanel from "./components/DeviceUsagePanel.vue";
import ScrapDialog from "./components/ScrapDialog.vue";

defineOptions({ name: "WhDeviceDetail" });

const route = useRoute();
const router = useRouter();
const id = computed(() => Number(route.params.id));
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const device = ref<DeviceDetail | null>(null);
const repairs = ref<TaskRow[]>([]);
const categories = ref<DeviceCategory[]>([]);
const editVisible = ref(false);
const scrapVisible = ref(false);

const load = async () => {
  const [detail, tasks] = await Promise.all([
    run(() => getDevice(id.value)),
    run(() =>
      listTasks({
        scope: "all",
        device_id: id.value,
        kind: "maintenance",
        status: "done",
        pageSize: 200
      })
    )
  ]);
  if (detail) device.value = detail.data;
  if (tasks) repairs.value = tasks.data;
};

const unscrap = async () => {
  const done = await run(
    () => unscrapDevice(id.value, { client_request_id: newClientRequestId() }),
    { success: "已撤销报废" }
  );
  if (done) await load();
};

onMounted(async () => {
  const [categoryResult] = await Promise.all([
    run(() => listDeviceCategories()),
    loadCaps(),
    load()
  ]);
  if (categoryResult) categories.value = categoryResult.data;
});
</script>

<template>
  <div v-loading="busy" class="detail">
    <el-card v-if="device" shadow="never">
      <template #header>
        <div class="head">
          <span class="title">{{ device.device_code }} {{ device.name }}</span>
          <el-tag :type="DEVICE_STATE_TAG[device.state]">{{
            device.state_label
          }}</el-tag>
          <div class="spacer" />
          <el-button @click="router.push('/wh/doc')">去库房单</el-button>
          <el-button v-if="caps?.is_keeper" @click="editVisible = true"
            >修改</el-button
          >
          <el-button
            v-if="caps?.can_scrap && device.state !== 'scrapped'"
            type="danger"
            plain
            @click="scrapVisible = true"
            >报废</el-button
          >
          <el-button
            v-if="caps?.can_unscrap && device.state === 'scrapped'"
            @click="unscrap"
            >撤销报废</el-button
          >
        </div>
      </template>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="类别">{{
          device.category_name
        }}</el-descriptions-item>
        <el-descriptions-item label="现场叫法">{{
          device.alias ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="所在项目">{{
          device.project_name ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="机型">{{
          device.machine_type ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="口径">{{
          device.diameter_mm ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="厂家">{{
          device.manufacturer ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="型号">{{
          device.model ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="出厂编号">{{
          device.serial_no ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="所有权">{{
          device.ownership === "leased_in" ? "租入" : "自有"
        }}</el-descriptions-item>
        <el-descriptions-item label="库位">{{
          device.storage_note ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{
          device.remark ?? "-"
        }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-if="device && device.open_tasks.length > 0" shadow="never">
      <template #header>未完成的任务</template>
      <el-table :data="device.open_tasks" size="small">
        <el-table-column prop="task_no" label="任务号" width="170" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }">{{
            TASK_KIND_LABELS[row.kind as keyof typeof TASK_KIND_LABELS]
          }}</template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="200" />
        <el-table-column label="阻塞发货" width="90">
          <template #default="{ row }">{{
            row.blocking ? "是" : "否"
          }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="device" shadow="never">
      <template #header>资料</template>
      <DeviceDocsCard
        :device-id="device.id"
        :device-label="`${device.device_code} ${device.name}`"
        :can-upload="Boolean(caps?.is_doc_admin)"
      />
    </el-card>

    <el-row v-if="device" :gutter="16">
      <el-col :md="14" :xs="24">
        <el-card shadow="never">
          <template #header>维修使用记录</template>
          <DeviceUsagePanel
            :records="device.usage_records"
            :total-meters="device.usage_meters_total"
            :repairs="repairs"
          />
        </el-card>
      </el-col>
      <el-col :md="10" :xs="24">
        <el-card shadow="never">
          <template #header>时间线</template>
          <DeviceTimeline :events="device.events" />
        </el-card>
      </el-col>
    </el-row>

    <DeviceFormDialog
      v-model="editVisible"
      :device="device"
      :categories="categories"
      @saved="load"
    />
    <ScrapDialog
      v-if="device"
      v-model="scrapVisible"
      :device-id="device.id"
      :device-code="device.device_code"
      @scrapped="load"
    />
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 16px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.title {
  font-weight: 600;
  font-size: 16px;
}
.spacer {
  flex: 1;
}
</style>
