<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { message } from "@/utils/message";

defineOptions({ name: "ReimbursementEnvelopeGenerator" });

type SizePreset = {
  label: string;
  value: string;
  widthMm: number;
  heightMm: number;
};

type Orientation = "landscape" | "portrait";

type EnvelopeItem = {
  uuid: string;
  qrDataUrl: string;
};

type BatchExport = {
  schemaVersion: 2;
  generatedAt: string;
  title: string;
  orientation: Orientation;
  page: { widthMm: number; heightMm: number };
  items: Array<{ uuid: string }>;
};

const SETTINGS_KEY = "hybc-envelope-generator-settings-v3";
const router = useRouter();

const sizePresets: SizePreset[] = [
  { label: "A4 (297x210mm)", value: "a4", widthMm: 297, heightMm: 210 },
  { label: "A3 (420x297mm)", value: "a3", widthMm: 420, heightMm: 297 },
  { label: "A5 (210x148mm)", value: "a5", widthMm: 210, heightMm: 148 },
  { label: "C4 (324x229mm)", value: "c4", widthMm: 324, heightMm: 229 },
  { label: "C5 (229x162mm)", value: "c5", widthMm: 229, heightMm: 162 },
  { label: "DL (220x110mm)", value: "dl", widthMm: 220, heightMm: 110 },
  { label: "自定义尺寸", value: "custom", widthMm: 297, heightMm: 210 }
];

const form = ref({
  count: 20,
  sizePreset: "a4",
  customWidthMm: 297,
  customHeightMm: 210,
  orientation: "landscape" as Orientation,
  title: "报销信封"
});

const generating = ref(false);
const generatedAt = ref("");
const items = ref<EnvelopeItem[]>([]);
const importFileInput = ref<HTMLInputElement | null>(null);

const activePreset = computed(
  () =>
    sizePresets.find(item => item.value === form.value.sizePreset) ??
    sizePresets[0]
);

const baseWidthMm = computed(() =>
  form.value.sizePreset === "custom"
    ? form.value.customWidthMm
    : activePreset.value.widthMm
);

const baseHeightMm = computed(() =>
  form.value.sizePreset === "custom"
    ? form.value.customHeightMm
    : activePreset.value.heightMm
);

const pageWidthMm = computed(() => {
  const longSide = Math.max(baseWidthMm.value, baseHeightMm.value);
  const shortSide = Math.min(baseWidthMm.value, baseHeightMm.value);
  return form.value.orientation === "landscape" ? longSide : shortSide;
});

const pageHeightMm = computed(() => {
  const longSide = Math.max(baseWidthMm.value, baseHeightMm.value);
  const shortSide = Math.min(baseWidthMm.value, baseHeightMm.value);
  return form.value.orientation === "landscape" ? shortSide : longSide;
});

const previewStyle = computed(() => ({
  width: `${pageWidthMm.value}mm`,
  minHeight: `${pageHeightMm.value}mm`
}));

const formatNow = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const createUuid = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const persistSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(form.value));
  } catch {
    // ignore
  }
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof form.value>;
    form.value = { ...form.value, ...parsed };
  } catch {
    // ignore
  }
};

const validateForm = () => {
  if (!Number.isFinite(form.value.count) || form.value.count <= 0) {
    message("请输入正确的生成数量", { type: "warning" });
    return false;
  }
  if (form.value.count > 500) {
    message("单次最多生成 500 份", { type: "warning" });
    return false;
  }
  if (pageWidthMm.value < 80 || pageHeightMm.value < 80) {
    message("尺寸过小，请调整", { type: "warning" });
    return false;
  }
  if (!form.value.title.trim()) {
    message("请输入标题", { type: "warning" });
    return false;
  }
  return true;
};

const generate = async () => {
  if (!validateForm()) return;
  generating.value = true;
  try {
    const uuids = Array.from({ length: Math.floor(form.value.count) }, () =>
      createUuid()
    );
    const qrData = await Promise.all(
      uuids.map(uuid =>
        QRCode.toDataURL(uuid, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 160
        })
      )
    );
    items.value = uuids.map((uuid, index) => ({
      uuid,
      qrDataUrl: qrData[index]
    }));
    generatedAt.value = formatNow();
    persistSettings();
    message(`已生成 ${items.value.length} 份`, { type: "success" });
  } catch {
    message("生成失败，请重试", { type: "error" });
  } finally {
    generating.value = false;
  }
};

const clearAll = () => {
  items.value = [];
  generatedAt.value = "";
};

const exportCsv = () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }
  const rows = [
    ["uuid", "generated_at"],
    ...items.value.map(item => [item.uuid, generatedAt.value])
  ];
  const text = rows
    .map(cols => cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `envelope-uuid-${(generatedAt.value || formatNow()).replace(/[\s:]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const exportJson = () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }
  const payload: BatchExport = {
    schemaVersion: 2,
    generatedAt: generatedAt.value || formatNow(),
    title: form.value.title.trim(),
    orientation: form.value.orientation,
    page: { widthMm: pageWidthMm.value, heightMm: pageHeightMm.value },
    items: items.value.map(item => ({ uuid: item.uuid }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `envelope-uuid-${payload.generatedAt.replace(/[\s:]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const triggerImport = () => {
  importFileInput.value?.click();
};

const importJson = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as Partial<BatchExport>;
    if (!Array.isArray(payload.items)) {
      throw new Error("invalid_schema");
    }
    const nextItems = await Promise.all(
      payload.items.map(async item => ({
        uuid: String(item.uuid || ""),
        qrDataUrl: await QRCode.toDataURL(String(item.uuid || ""), {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 160
        })
      }))
    );
    items.value = nextItems;
    generatedAt.value =
      typeof payload.generatedAt === "string"
        ? payload.generatedAt
        : formatNow();

    if (payload.page) {
      form.value.sizePreset = "custom";
      form.value.customWidthMm = Number(
        payload.page.widthMm || form.value.customWidthMm
      );
      form.value.customHeightMm = Number(
        payload.page.heightMm || form.value.customHeightMm
      );
    }
    if (
      payload.orientation === "landscape" ||
      payload.orientation === "portrait"
    ) {
      form.value.orientation = payload.orientation;
    }
    if (typeof payload.title === "string" && payload.title.trim()) {
      form.value.title = payload.title;
    }

    persistSettings();
    message(`已导入 ${items.value.length} 份`, { type: "success" });
  } catch {
    message("导入失败：文件格式不正确", { type: "error" });
  }
};

const mmToPx = (mm: number) => (mm * 96) / 25.4;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });

const renderEnvelopeCanvas = async (item: EnvelopeItem) => {
  const scale = 2;
  const widthPx = Math.max(1, Math.round(mmToPx(pageWidthMm.value)));
  const heightPx = Math.max(1, Math.round(mmToPx(pageHeightMm.value)));

  const canvas = document.createElement("canvas");
  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas_context_failed");
  }

  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  const margin = mmToPx(8);
  ctx.fillStyle = "#685f54";
  ctx.font = `${Math.round(mmToPx(3.3))}px sans-serif`;
  ctx.fillText(`生成时间：${generatedAt.value}`, margin, margin + mmToPx(2));

  ctx.fillStyle = "#1f1f1f";
  ctx.textAlign = "center";
  ctx.font = `700 ${Math.round(mmToPx(4.4))}px sans-serif`;
  ctx.fillText(form.value.title.trim(), widthPx / 2, margin + mmToPx(12));

  const qrSize = mmToPx(30);
  const qrX = margin;
  const qrY = margin + mmToPx(16);
  const qrImage = await loadImage(item.qrDataUrl);
  ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);

  const textX = qrX + qrSize + mmToPx(8);
  const textY = qrY + mmToPx(1);
  const bodyFont = Math.round(mmToPx(4.1));
  ctx.textAlign = "left";
  ctx.fillStyle = "#1f1f1f";
  ctx.font = `${bodyFont}px sans-serif`;

  const uuidMaxWidth = widthPx - textX - margin;
  const rawUuid = item.uuid;
  const uuidChunks: string[] = [];
  let start = 0;
  while (start < rawUuid.length) {
    let end = start + 1;
    while (
      end <= rawUuid.length &&
      ctx.measureText(rawUuid.slice(start, end)).width <= uuidMaxWidth
    ) {
      end += 1;
    }
    uuidChunks.push(rawUuid.slice(start, Math.max(start + 1, end - 1)));
    start = Math.max(start + 1, end - 1);
  }

  uuidChunks.forEach((line, index) => {
    ctx.fillText(
      line,
      textX,
      textY + bodyFont + index * Math.round(bodyFont * 1.35)
    );
  });

  const lineStartY =
    textY + Math.round(bodyFont * 1.35) * Math.max(2, uuidChunks.length + 1);
  ctx.fillText("封装日期：________年____月____日", textX, lineStartY);
  ctx.fillText(
    "签收日期：________年____月____日",
    textX,
    lineStartY + Math.round(bodyFont * 1.6)
  );
  ctx.fillText(
    "填 报 人：________________",
    textX,
    lineStartY + Math.round(bodyFont * 3.2)
  );

  return canvas;
};

const buildPdf = async () => {
  const pdf = new jsPDF({
    orientation: form.value.orientation,
    unit: "mm",
    format: [pageWidthMm.value, pageHeightMm.value]
  });

  for (let i = 0; i < items.value.length; i += 1) {
    const canvas = await renderEnvelopeCanvas(items.value[i]);
    const imgData = canvas.toDataURL("image/png");
    if (i > 0) {
      pdf.addPage(
        [pageWidthMm.value, pageHeightMm.value],
        form.value.orientation
      );
    }
    pdf.addImage(
      imgData,
      "PNG",
      0,
      0,
      pageWidthMm.value,
      pageHeightMm.value,
      undefined,
      "FAST"
    );
  }

  return pdf;
};

const exportPdf = async () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }

  try {
    const pdf = await buildPdf();

    pdf.save(
      `reimbursement-envelope-${(generatedAt.value || formatNow()).replace(/[\s:]/g, "-")}.pdf`
    );
    message("PDF 已生成并开始下载", { type: "success" });
  } catch {
    message("PDF 生成失败，请重试", { type: "error" });
  }
};

const printPdf = async () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }

  try {
    const pdf = await buildPdf();

    const blob = pdf.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      message("浏览器拦截了打印窗口，请允许弹窗后重试", { type: "warning" });
      URL.revokeObjectURL(blobUrl);
      return;
    }
    const tryPrint = () => {
      try {
        win.focus();
        win.print();
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
      }
    };
    win.addEventListener("load", tryPrint, { once: true });
    setTimeout(tryPrint, 1200);
  } catch {
    message("打印失败，请重试", { type: "error" });
  }
};

const goBack = () => {
  router.push("/finance/reimbursement");
};

onMounted(() => {
  loadSettings();
});
</script>

<template>
  <div class="generator-page">
    <el-card shadow="never">
      <template #header>
        <div class="title-row">
          <span>信封生成器（离线）</span>
          <div class="actions">
            <el-button @click="goBack">返回报销处理</el-button>
            <el-button @click="clearAll">清空</el-button>
            <el-button type="primary" :loading="generating" @click="generate"
              >生成</el-button
            >
            <el-button type="success" plain @click="exportPdf"
              >直接生成PDF</el-button
            >
            <el-button type="success" plain @click="printPdf"
              >打印PDF</el-button
            >
            <el-button type="warning" plain @click="exportCsv"
              >导出CSV</el-button
            >
            <el-button type="warning" plain @click="exportJson"
              >导出JSON</el-button
            >
            <el-button plain @click="triggerImport">导入JSON</el-button>
          </div>
        </div>
      </template>

      <el-form label-width="110px" class="control-form">
        <el-form-item label="生成数量" required>
          <el-input-number v-model="form.count" :min="1" :max="500" />
        </el-form-item>
        <el-form-item label="输出尺寸" required>
          <div class="inline-row">
            <el-select v-model="form.sizePreset" style="width: 280px">
              <el-option
                v-for="item in sizePresets"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <template v-if="form.sizePreset === 'custom'">
              <el-input-number
                v-model="form.customWidthMm"
                :min="80"
                :max="1000"
              />
              <span>mm ×</span>
              <el-input-number
                v-model="form.customHeightMm"
                :min="80"
                :max="1000"
              />
              <span>mm</span>
            </template>
          </div>
        </el-form-item>
        <el-form-item label="打印方向" required>
          <el-radio-group v-model="form.orientation">
            <el-radio-button label="landscape">横向</el-radio-button>
            <el-radio-button label="portrait">纵向</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="自定义标题" required>
          <el-input v-model="form.title" style="width: 320px" />
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        title="已修复中文乱码：PDF 采用页面渲染方式输出。"
      />

      <input
        ref="importFileInput"
        type="file"
        accept="application/json,.json"
        class="hidden-file-input"
        @change="importJson"
      />
    </el-card>

    <div v-if="items.length" class="preview-page" :style="previewStyle">
      <div class="meta">生成时间：{{ generatedAt }}</div>
      <div class="preview-content">
        <div class="preview-title">{{ form.title }}</div>
        <div class="preview-layout">
          <img class="preview-qr" :src="items[0].qrDataUrl" alt="uuid-qr" />
          <div class="preview-right">
            <div class="uuid">{{ items[0].uuid }}</div>
            <div>封装日期：________年____月____日</div>
            <div>签收日期：________年____月____日</div>
            <div>填 报 人：________________</div>
          </div>
        </div>
      </div>
      <div class="meta">
        预览仅显示第 1 份，PDF 会包含全部 {{ items.length }} 份
      </div>
    </div>
    <el-empty v-else description="请先生成数据" />
  </div>
</template>

<style scoped>
.generator-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.control-form {
  margin-bottom: 12px;
}

.inline-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.hidden-file-input {
  display: none;
}

.preview-page {
  margin: 0 auto;
  background: #fff;
  box-shadow: 0 6px 24px rgb(29 28 38 / 12%);
  padding: 8mm;
}

.meta {
  color: #685f54;
  font-size: 12px;
}

.preview-content {
  margin: 6mm 0;
  padding: 2mm;
}

.preview-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4mm;
}

.preview-layout {
  display: flex;
  gap: 7mm;
  align-items: center;
}

.preview-qr {
  width: 30mm;
  height: 30mm;
}

.preview-right {
  display: flex;
  flex-direction: column;
  gap: 4mm;
  font-size: 14px;
}

.uuid {
  font-size: 14px;
  word-break: break-all;
}
</style>
