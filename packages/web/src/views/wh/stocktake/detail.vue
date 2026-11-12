<script setup lang="ts">
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  cancelStocktake,
  completeStocktake,
  getStocktake,
  markStocktakeDevice,
  saveStocktakeCount
} from "@/api/wh/stocktake";
import type {
  DeviceMarkInput,
  StocktakeCountInput,
  StocktakeDetail
} from "@/api/wh/stocktake-types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { message } from "@/utils/message";
import { formatTime } from "../shared/ids";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import CompleteStocktakeDialog from "./components/CompleteStocktakeDialog.vue";
import DeviceCheckTable from "./components/DeviceCheckTable.vue";
import MaterialCountTable from "./components/MaterialCountTable.vue";
import {
  applyDeviceLine,
  applyMaterialLine,
  progressText,
  SCOPE_LABELS,
  STATUS_LABELS,
  STATUS_TAG
} from "./stocktake-view";

defineOptions({ name: "WhStocktakeDetail" });

const route = useRoute();
const router = useRouter();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
// 录数和标记设备不用整页的加载遮罩：遮罩会挡住下一行的输入框，连着录的时候字会丢
const { run: runQuietly } = useWhAction();
const { userNameOf, loadUserNames } = useWecomUserOptions();

const detail = ref<StocktakeDetail | null>(null);
const tab = ref<"material" | "device">("material");
const completeOpen = ref(false);

const stocktakeId = computed(() => Number(route.params.id));
const editable = computed(
  () => Boolean(caps.value?.is_keeper) && detail.value?.status === "counting"
);
const hasMaterials = computed(() => detail.value?.scope !== "device");
const hasDevices = computed(() => detail.value?.scope !== "material");

const load = async () => {
  const result = await run(() => getStocktake(stocktakeId.value));
  if (!result) return false;
  detail.value = result.data;
  if (result.data.scope === "device") tab.value = "device";
  if (result.data.scope === "material") tab.value = "material";
  return true;
};

const onSaveCount = async (lineId: number, data: StocktakeCountInput) => {
  const result = await runQuietly(() =>
    saveStocktakeCount(stocktakeId.value, lineId, data)
  );
  if (result && detail.value) {
    detail.value = applyMaterialLine(detail.value, result.data);
  }
};

const onMarkDevice = async (data: DeviceMarkInput) => {
  const result = await runQuietly(() =>
    markStocktakeDevice(stocktakeId.value, data)
  );
  if (!result || !detail.value) return;
  detail.value = applyDeviceLine(detail.value, result.data.line);
  if (result.data.hint) {
    message(`${result.data.line.device_code}：${result.data.hint}`, {
      type: "warning",
      duration: 6000
    });
  } else if (data.device_code) {
    message(`${result.data.line.device_code} 已标记找到`, { type: "success" });
  }
};

// 完成前重新取一次：拿到最新的版本和汇总数（录数时本地没有更新版本）
const openComplete = async () => {
  if (await load()) completeOpen.value = true;
};

const onComplete = async () => {
  if (!detail.value) return;
  const version = detail.value.version;
  const result = await run(() => completeStocktake(stocktakeId.value, version));
  if (!result) {
    // 多半是和别人的录入撞上了：关掉确认，重新取，让人再看一眼
    completeOpen.value = false;
    void load();
    return;
  }
  completeOpen.value = false;
  detail.value = result.data.stocktake;
  message(
    result.data.adjust_doc
      ? `盘点已完成，调整单 ${result.data.adjust_doc.doc_no}`
      : "盘点已完成，没有差额",
    { type: "success" }
  );
};

const onCancel = async () => {
  let reason = "";
  try {
    const { value } = (await ElMessageBox.prompt(
      "取消之后这次录的数都不算，库存不变。",
      "取消盘点",
      {
        inputPlaceholder: "原因（可不填）",
        inputValidator: (text: string) =>
          (text ?? "").length <= 200 || "原因不能超过 200 个字",
        confirmButtonText: "取消盘点",
        cancelButtonText: "接着盘",
        type: "warning"
      }
    )) as MessageBoxInputData;
    reason = (value ?? "").trim();
  } catch {
    return;
  }
  const result = await run(() => cancelStocktake(stocktakeId.value, reason), {
    success: "盘点已取消"
  });
  if (result) detail.value = result.data;
  else void load();
};

watch(stocktakeId, () => void load());

onMounted(async () => {
  void loadUserNames();
  await loadCaps();
  await load();
});
</script>

<template>
  <div v-loading="busy" class="page">
    <el-card v-if="detail" shadow="never">
      <div class="head">
        <div class="title">
          {{ detail.stocktake_no }}
          <el-tag :type="STATUS_TAG[detail.status]">{{
            STATUS_LABELS[detail.status]
          }}</el-tag>
        </div>
        <span class="spacer" />
        <template v-if="editable">
          <el-button @click="onCancel">取消盘点</el-button>
          <el-button type="primary" @click="openComplete">完成盘点</el-button>
        </template>
        <el-button @click="router.push('/wh/stocktake')">返回列表</el-button>
      </div>
      <el-descriptions :column="4" size="small" border>
        <el-descriptions-item label="范围">{{
          SCOPE_LABELS[detail.scope]
        }}</el-descriptions-item>
        <el-descriptions-item label="发起">
          {{ userNameOf(detail.created_by_userid) }}
          {{ formatTime(detail.created_at) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.status === 'done'" label="完成">
          {{ userNameOf(detail.completed_by_userid) }}
          {{ formatTime(detail.completed_at) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.status === 'cancelled'" label="取消">
          {{ userNameOf(detail.cancelled_by_userid) }}
          {{ formatTime(detail.cancelled_at) }}
          <template v-if="detail.cancel_reason"
            >（{{ detail.cancel_reason }}）</template
          >
        </el-descriptions-item>
        <el-descriptions-item v-if="hasMaterials" label="物资已盘">
          {{ progressText(detail, "material") }}
          <template v-if="detail.material_diff > 0"
            >，{{ detail.material_diff }} 条有差额</template
          >
        </el-descriptions-item>
        <el-descriptions-item v-if="hasDevices" label="设备找到">
          {{ progressText(detail, "device") }}
          <template v-if="detail.device_unexpected > 0"
            >，另有 {{ detail.device_unexpected }} 台账上不在库</template
          >
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.status === 'done'" label="调整单">
          <el-button
            v-if="detail.adjust_doc_no"
            link
            type="primary"
            @click="router.push('/wh/doc')"
            >{{ detail.adjust_doc_no }}</el-button
          >
          <template v-else>没有差额，没出调整单</template>
        </el-descriptions-item>
        <el-descriptions-item v-if="detail.remark" label="备注">{{
          detail.remark
        }}</el-descriptions-item>
      </el-descriptions>
      <el-alert
        v-if="detail.status === 'counting' && caps && !caps.is_keeper"
        class="notice"
        type="info"
        :closable="false"
        show-icon
        title="盘点由库管录入，这里只能看。"
      />

      <el-tabs v-model="tab" class="tabs">
        <el-tab-pane v-if="hasMaterials" label="物资" name="material">
          <MaterialCountTable
            :lines="detail.material_lines"
            :editable="editable"
            @save="onSaveCount"
          />
        </el-tab-pane>
        <el-tab-pane v-if="hasDevices" label="设备" name="device">
          <DeviceCheckTable
            :lines="detail.device_lines"
            :status="detail.status"
            :editable="editable"
            @mark="onMarkDevice"
          />
        </el-tab-pane>
      </el-tabs>
    </el-card>
    <el-empty v-else-if="!busy" description="盘点不存在" />
    <CompleteStocktakeDialog
      v-model="completeOpen"
      :detail="detail"
      :busy="busy"
      @confirm="onComplete"
    />
  </div>
</template>

<style scoped>
.page {
  min-height: 200px;
}

.head {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.title {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.notice {
  margin-top: 12px;
}

.tabs {
  margin-top: 12px;
}
</style>
