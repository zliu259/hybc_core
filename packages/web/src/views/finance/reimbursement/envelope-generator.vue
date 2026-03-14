<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
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
const pdfPageRefs = ref<(HTMLElement | null)[]>([]);

const activePreset = computed(
  () => sizePresets.find(item => item.value === form.value.sizePreset) ?? sizePresets[0]
);

const baseWidthMm = computed(() =>
  form.value.sizePreset === "custom" ? form.value.customWidthMm : activePreset.value.widthMm
);

const baseHeightMm = computed(() =>
  form.value.sizePreset === "custom" ? form.value.customHeightMm : activePreset.value.heightMm
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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const setPdfPageRef = (el: unknown, index: number) => {
  if (!el) {
    pdfPageRefs.value[index] = null;
    return;
  }
  if (el instanceof HTMLElement) {
    pdfPageRefs.value[index] = el;
    return;
  }
  const maybe = el as { $el?: unknown };
  pdfPageRefs.value[index] = maybe.$el instanceof HTMLElement ? maybe.$el : null;
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
    const uuids = Array.from({ length: Math.floor(form.value.count) }, () => createUuid());
    const qrData = await Promise.all(
      uuids.map(uuid =>
        QRCode.toDataURL(uuid, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 160
        })
      )
    );
    items.value = uuids.map((uuid, index) => ({ uuid, qrDataUrl: qrData[index] }));
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
  pdfPageRefs.value = [];
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
    generatedAt.value = typeof payload.generatedAt === "string" ? payload.generatedAt : formatNow();

    if (payload.page) {
      form.value.sizePreset = "custom";
      form.value.customWidthMm = Number(payload.page.widthMm || form.value.customWidthMm);
      form.value.customHeightMm = Number(payload.page.heightMm || form.value.customHeightMm);
    }
    if (payload.orientation === "landscape" || payload.orientation === "portrait") {
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

const exportPdf = async () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }

  try {
    await nextTick();
    const pages = pdfPageRefs.value.filter((el): el is HTMLElement => Boolean(el));
    if (!pages.length) {
      message("未找到可导出的页面", { type: "error" });
      return;
    }

    const pdf = new jsPDF({
      orientation: form.value.orientation,
      unit: "mm",
      format: [pageWidthMm.value, pageHeightMm.value]
    });

    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      const imgData = canvas.toDataURL("image/png");
      if (i > 0) {
        pdf.addPage([pageWidthMm.value, pageHeightMm.value], form.value.orientation);
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

    pdf.save(`reimbursement-envelope-${(generatedAt.value || formatNow()).replace(/[\s:]/g, "-")}.pdf`);
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
    await nextTick();
    const pages = pdfPageRefs.value.filter((el): el is HTMLElement => Boolean(el));
    if (!pages.length) {
      message("未找到可打印的页面", { type: "error" });
      return;
    }

    const pdf = new jsPDF({
      orientation: form.value.orientation,
      unit: "mm",
      format: [pageWidthMm.value, pageHeightMm.value]
    });

    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i], {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      const imgData = canvas.toDataURL("image/png");
      if (i > 0) {
        pdf.addPage([pageWidthMm.value, pageHeightMm.value], form.value.orientation);
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

    const blob = pdf.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, "_blank");
    if (!win) {
      message("浏览器拦截了打印窗口，请允许弹窗后重试", { type: "warning" });
      URL.revokeObjectURL(blobUrl);
      return;
    }
    win.onload = () => {
      win.focus();
      win.print();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    };
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
            <el-button type="primary" :loading="generating" @click="generate">生成</el-button>
            <el-button type="success" plain @click="exportPdf">直接生成PDF</el-button>
            <el-button type="success" plain @click="printPdf">打印PDF</el-button>
            <el-button type="warning" plain @click="exportCsv">导出CSV</el-button>
            <el-button type="warning" plain @click="exportJson">导出JSON</el-button>
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
              <el-input-number v-model="form.customWidthMm" :min="80" :max="1000" />
              <span>mm ×</span>
              <el-input-number v-model="form.customHeightMm" :min="80" :max="1000" />
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
      <div class="meta">预览仅显示第 1 份，PDF 会包含全部 {{ items.length }} 份</div>
    </div>
    <el-empty v-else description="请先生成数据" />

    <div class="pdf-host">
      <div
        v-for="(item, index) in items"
        :key="`${item.uuid}-${index}`"
        :ref="el => setPdfPageRef(el, index)"
        class="pdf-page"
        :style="previewStyle"
      >
        <div class="pdf-meta">生成时间：{{ generatedAt }}</div>
        <div class="pdf-title">{{ form.title }}</div>
        <div class="pdf-layout">
          <img class="pdf-qr" :src="item.qrDataUrl" alt="pdf-qr" />
          <div class="pdf-right">
            <div class="uuid">{{ item.uuid }}</div>
            <div>封装日期：________年____月____日</div>
            <div>签收日期：________年____月____日</div>
            <div>填 报 人：________________</div>
          </div>
        </div>
      </div>
    </div>
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

.preview-title,
.pdf-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4mm;
}

.preview-layout,
.pdf-layout {
  display: flex;
  gap: 7mm;
  align-items: center;
}

.preview-qr,
.pdf-qr {
  width: 30mm;
  height: 30mm;
}

.preview-right,
.pdf-right {
  display: flex;
  flex-direction: column;
  gap: 4mm;
  font-size: 14px;
}

.uuid {
  font-size: 14px;
  word-break: break-all;
}

.pdf-host {
  position: fixed;
  left: -20000px;
  top: 0;
  opacity: 0;
  pointer-events: none;
}

.pdf-page {
  background: #fff;
  padding: 8mm;
  box-sizing: border-box;
}

.pdf-meta {
  color: #685f54;
  font-size: 12px;
}
</style>
