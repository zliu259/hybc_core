<script setup lang="ts">
import QRCode from "qrcode";
import { ref, watch } from "vue";

import type { DeviceRow } from "@/api/wh/types";
import { message } from "@/utils/message";
import { deviceQrPayload } from "../../shared/qr";

const props = defineProps<{ devices: DeviceRow[] }>();
const visible = defineModel<boolean>({ required: true });
const labels = ref<{ code: string; name: string; image: string }[]>([]);

watch(visible, async open => {
  if (!open) return;
  labels.value = await Promise.all(
    props.devices.map(async device => ({
      code: device.device_code,
      name: device.name,
      image: await QRCode.toDataURL(deviceQrPayload(device.device_code), {
        margin: 1,
        width: 240
      })
    }))
  );
});

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    char =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char
  );

/** A4 每页 3 列 8 行，每格二维码 30 毫米见方加编号和名称。用新窗口打印，不影响当前页面。 */
const print = () => {
  const win = window.open("", "_blank");
  if (!win) {
    message("浏览器拦截了打印窗口，请允许弹出窗口后再试", { type: "warning" });
    return;
  }
  const cells = labels.value
    .map(
      label =>
        `<div class="cell"><img src="${label.image}"/><div class="code">${escapeHtml(label.code)}</div><div class="name">${escapeHtml(label.name)}</div></div>`
    )
    .join("");
  win.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>设备二维码</title><style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; font-family: sans-serif; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 34mm; gap: 2mm; }
    .cell { display: flex; flex-direction: column; align-items: center; justify-content: center; border: 0.2mm dashed #ccc; overflow: hidden; break-inside: avoid; }
    img { width: 22mm; height: 22mm; }
    .code { font-size: 10pt; font-weight: bold; }
    .name { font-size: 7pt; max-width: 60mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  </style></head><body><div class="grid">${cells}</div></body></html>`);
  win.document.close();
  win.focus();
  win.print();
};
</script>

<template>
  <el-dialog v-model="visible" title="打印设备二维码" width="720px">
    <p class="hint">
      共 {{ labels.length }} 张，A4 纸每页 24 张。扫码内容是 HYBC:D:设备编号。
    </p>
    <div class="preview">
      <div v-for="label in labels" :key="label.code" class="cell">
        <img :src="label.image" alt="" />
        <div class="code">{{ label.code }}</div>
        <div class="name">{{ label.name }}</div>
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :disabled="labels.length === 0" @click="print"
        >打印</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.preview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}
.cell {
  text-align: center;
  border: 1px dashed var(--el-border-color);
  padding: 6px;
}
.cell img {
  width: 96px;
  height: 96px;
}
.code {
  font-weight: 600;
}
.name {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
