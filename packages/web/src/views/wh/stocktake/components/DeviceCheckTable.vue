<script setup lang="ts">
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { ref } from "vue";

import type {
  DeviceMarkInput,
  StocktakeDeviceLineRow,
  StocktakeStatus
} from "@/api/wh/stocktake-types";
import { deviceLineStatus } from "../stocktake-view";

/** 设备盘点表：逐台标记找到没找到。顶上的输入框输编号回车，等于手机上扫一下码。 */
const props = defineProps<{
  lines: StocktakeDeviceLineRow[];
  status: StocktakeStatus;
  editable: boolean;
}>();
const emit = defineEmits<{ mark: [data: DeviceMarkInput] }>();

const code = ref("");

const submitCode = () => {
  const value = code.value.trim();
  if (!value) return;
  code.value = "";
  emit("mark", { device_code: value, found: true });
};

const markMissing = async (line: StocktakeDeviceLineRow) => {
  try {
    const { value } = (await ElMessageBox.prompt(
      `${line.device_code} ${line.device_name}`,
      "标记没找到",
      {
        inputPlaceholder: "备注（可不填），比如：借给二队了",
        inputValue: line.note ?? "",
        inputValidator: (text: string) =>
          (text ?? "").length <= 200 || "备注不能超过 200 个字",
        confirmButtonText: "标记没找到",
        cancelButtonText: "取消"
      }
    )) as MessageBoxInputData;
    emit("mark", {
      device_id: line.device_id,
      found: false,
      note: (value ?? "").trim()
    });
  } catch {
    // 点了取消
  }
};
</script>

<template>
  <div>
    <div v-if="props.editable" class="toolbar">
      <el-input
        v-model="code"
        clearable
        placeholder="输设备编号后回车，标记找到"
        style="width: 280px"
        @keyup.enter="submitCode"
      />
      <el-button :disabled="!code.trim()" @click="submitCode"
        >标记找到</el-button
      >
      <span class="hint">手机上可以连续扫码</span>
    </div>
    <el-table :data="props.lines" row-key="id" size="small">
      <el-table-column prop="device_code" label="编号" width="120" />
      <el-table-column label="名称" min-width="200">
        <template #default="{ row }">
          <div>{{ row.device_name }}</div>
          <div v-if="row.alias" class="sub">{{ row.alias }}</div>
        </template>
      </el-table-column>
      <el-table-column label="类别" width="120">
        <template #default="{ row }">{{ row.category_name ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="库位" width="120">
        <template #default="{ row }">{{ row.storage_note ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="盘点结果" width="200">
        <template #default="{ row }">
          <el-tag :type="deviceLineStatus(row, props.status).type">{{
            deviceLineStatus(row, props.status).text
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="{ row }">{{ row.note ?? "" }}</template>
      </el-table-column>
      <el-table-column v-if="props.editable" label="操作" width="200">
        <template #default="{ row }">
          <el-button
            v-if="row.found !== 1"
            link
            type="primary"
            @click="emit('mark', { device_id: row.device_id, found: true })"
            >找到</el-button
          >
          <el-button
            v-if="row.expected === 1 && row.found !== 0"
            link
            type="danger"
            @click="markMissing(row)"
            >没找到</el-button
          >
          <el-button
            v-if="row.found !== null"
            link
            @click="
              emit('mark', { device_id: row.device_id, found: null, note: '' })
            "
            >清掉</el-button
          >
        </template>
      </el-table-column>
      <template #empty>这次盘点没有设备</template>
    </el-table>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.hint,
.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
