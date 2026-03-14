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

type EnvelopeItem = {
  uuid: string;
  qrDataUrl: string;
};

type BatchExport = {
  schemaVersion: 1;
  generatedAt: string;
  page: { widthMm: number; heightMm: number };
  items: Array<{ uuid: string }>;
};

const SETTINGS_KEY = "hybc-envelope-generator-settings-v2";
const router = useRouter();

const sizePresets: SizePreset[] = [
  { label: "A4 横向 (297x210mm)", value: "a4-landscape", widthMm: 297, heightMm: 210 },
  { label: "A3 横向 (420x297mm)", value: "a3-landscape", widthMm: 420, heightMm: 297 },
  { label: "A5 横向 (210x148mm)", value: "a5-landscape", widthMm: 210, heightMm: 148 },
  { label: "C4 横向 (324x229mm)", value: "c4-landscape", widthMm: 324, heightMm: 229 },
  { label: "C5 横向 (229x162mm)", value: "c5-landscape", widthMm: 229, heightMm: 162 },
  { label: "DL 横向 (220x110mm)", value: "dl-landscape", widthMm: 220, heightMm: 110 },
  { label: "自定义尺寸", value: "custom", widthMm: 297, heightMm: 210 }
];

const form = ref({
  count: 20,
  sizePreset: "a4-landscape",
  customWidthMm: 297,
  customHeightMm: 210
});

const generating = ref(false);
const generatedAt = ref("");
const items = ref<EnvelopeItem[]>([]);
const importFileInput = ref<HTMLInputElement | null>(null);

const activePreset = computed(
  () => sizePresets.find(item => item.value === form.value.sizePreset) ?? sizePresets[0]
);

const pageWidthMm = computed(() =>
  form.value.sizePreset === "custom" ? form.value.customWidthMm : activePreset.value.widthMm
);

const pageHeightMm = computed(() =>
  form.value.sizePreset === "custom" ? form.value.customHeightMm : activePreset.value.heightMm
);

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
          width: 220
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
    schemaVersion: 1,
    generatedAt: generatedAt.value || formatNow(),
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
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.items)) {
      throw new Error("invalid_schema");
    }
    const nextItems = await Promise.all(
      payload.items.map(async item => ({
        uuid: String(item.uuid || ""),
        qrDataUrl: await QRCode.toDataURL(String(item.uuid || ""), {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220
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
    persistSettings();
    message(`已导入 ${items.value.length} 份`, { type: "success" });
  } catch {
    message("导入失败：文件格式不正确", { type: "error" });
  }
};

const buildPdfPageSize = () => {
  const longSide = Math.max(pageWidthMm.value, pageHeightMm.value);
  const shortSide = Math.min(pageWidthMm.value, pageHeightMm.value);
  return { width: longSide, height: shortSide };
};

const exportPdf = () => {
  if (!items.value.length) {
    message("请先生成数据", { type: "warning" });
    return;
  }

  const { width, height } = buildPdfPageSize();
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: [width, height]
  });

  items.value.forEach((item, index) => {
    if (index > 0) pdf.addPage([width, height], "landscape");

    const margin = 10;
    const cardX = margin;
    const cardY = margin;
    const cardW = width - margin * 2;
    const cardH = height - margin * 2;
    pdf.setDrawColor(0);
    pdf.rect(cardX, cardY, cardW, cardH);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("报销信封", cardX + cardW / 2, cardY + 12, { align: "center" });

    const qrSize = Math.min(cardH * 0.44, 72);
    const qrX = cardX + 12;
    const qrY = cardY + 20;
    pdf.addImage(item.qrDataUrl, "PNG", qrX, qrY, qrSize, qrSize, undefined, "FAST");

    const textX = qrX + qrSize + 12;
    const textWidth = cardW - qrSize - 28;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    const uuidLines = pdf.splitTextToSize(item.uuid, textWidth);
    pdf.text(uuidLines, textX, qrY + 6);

    const lineY = qrY + qrSize + 12;
    pdf.setFontSize(12);
    pdf.text("封装日期：____年__月__日", textX, lineY);
    pdf.text("签收日期：____年__月__日", textX, lineY + 12);
    pdf.text("填 报 人：________________", textX, lineY + 24);

    pdf.setFontSize(9);
    pdf.text(`生成时间：${generatedAt.value}`, cardX + 4, cardY + cardH - 4);
  });

  const filename = `reimbursement-envelope-${(generatedAt.value || formatNow()).replace(/[\s:]/g, "-")}.pdf`;
  pdf.save(filename);
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
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        title="已按横向输出设计，支持纸张和信封两类尺寸；一键生成 PDF。"
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
        <div class="preview-title">报销信封</div>
        <div class="preview-layout">
          <img class="preview-qr" :src="items[0].qrDataUrl" alt="uuid-qr" />
          <div class="preview-right">
            <div class="uuid">{{ items[0].uuid }}</div>
            <div>封装日期：____年__月__日</div>
            <div>签收日期：____年__月__日</div>
            <div>填 报 人：________________</div>
          </div>
        </div>
      </div>
      <div class="meta">预览仅显示第 1 份，PDF 会包含全部 {{ items.length }} 份</div>
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
  border: 1px dashed #c6d6ea;
  box-shadow: 0 6px 24px rgb(29 28 38 / 12%);
  padding: 8mm;
}

.meta {
  color: #685f54;
  font-size: 12px;
}

.preview-content {
  border: 1px solid #2f2f2f;
  margin: 6mm 0;
  padding: 5mm;
}

.preview-title {
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 4mm;
}

.preview-layout {
  display: flex;
  gap: 6mm;
  align-items: center;
}

.preview-qr {
  width: 40mm;
  height: 40mm;
  border: 1px solid #ddd;
}

.preview-right {
  display: flex;
  flex-direction: column;
  gap: 4mm;
}

.uuid {
  font-size: 11px;
  word-break: break-all;
}
</style>
