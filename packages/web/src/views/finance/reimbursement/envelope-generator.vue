<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import { message } from "@/utils/message";

defineOptions({ name: "ReimbursementEnvelopeGenerator" });

type PaperPreset = {
  label: string;
  value: string;
  widthMm: number;
  heightMm: number;
};

type EnvelopePreset = {
  label: string;
  value: string;
  widthMm: number;
  heightMm: number;
};

type EnvelopeSampleItem = {
  envelopeNo: string;
  uuid: string;
  qrDataUrl: string;
};

type EnvelopeBatchExport = {
  schemaVersion: 1;
  batchName: string;
  generatedAt: string;
  paper: { widthMm: number; heightMm: number };
  envelope: { widthMm: number; heightMm: number };
  items: Array<{ envelopeNo: string; uuid: string }>;
};

const SETTINGS_KEY = "hybc-reimbursement-envelope-generator-settings-v1";

const router = useRouter();

const paperPresets: PaperPreset[] = [
  { label: "A4 (210x297mm)", value: "a4", widthMm: 210, heightMm: 297 },
  { label: "A3 (297x420mm)", value: "a3", widthMm: 297, heightMm: 420 },
  { label: "A5 (148x210mm)", value: "a5", widthMm: 148, heightMm: 210 },
  { label: "B5 (176x250mm)", value: "b5", widthMm: 176, heightMm: 250 },
  { label: "Letter (216x279mm)", value: "letter", widthMm: 216, heightMm: 279 },
  { label: "Legal (216x356mm)", value: "legal", widthMm: 216, heightMm: 356 },
  { label: "自定义", value: "custom", widthMm: 210, heightMm: 297 }
];

const envelopePresets: EnvelopePreset[] = [
  { label: "C4 (229x324mm)", value: "c4", widthMm: 229, heightMm: 324 },
  { label: "C5 (162x229mm)", value: "c5", widthMm: 162, heightMm: 229 },
  { label: "C6 (114x162mm)", value: "c6", widthMm: 114, heightMm: 162 },
  { label: "DL (110x220mm)", value: "dl", widthMm: 110, heightMm: 220 },
  { label: "国内常用档案袋(240x340mm)", value: "cn-file", widthMm: 240, heightMm: 340 },
  { label: "自定义", value: "custom", widthMm: 240, heightMm: 340 }
];

const form = ref({
  count: 6,
  paperPreset: "a4",
  customPaperWidth: 210,
  customPaperHeight: 297,
  envelopePreset: "cn-file",
  customEnvelopeWidth: 240,
  customEnvelopeHeight: 340,
  labelPrefix: "报销信封",
  batchName: ""
});

const generating = ref(false);
const generatedAt = ref("");
const samples = ref<EnvelopeSampleItem[]>([]);
const importFileInput = ref<HTMLInputElement | null>(null);

const activePaper = computed(() =>
  paperPresets.find(item => item.value === form.value.paperPreset) ?? paperPresets[0]
);

const activeEnvelope = computed(() =>
  envelopePresets.find(item => item.value === form.value.envelopePreset) ?? envelopePresets[0]
);

const paperWidthMm = computed(() =>
  form.value.paperPreset === "custom"
    ? form.value.customPaperWidth
    : activePaper.value.widthMm
);

const paperHeightMm = computed(() =>
  form.value.paperPreset === "custom"
    ? form.value.customPaperHeight
    : activePaper.value.heightMm
);

const envelopeWidthMm = computed(() =>
  form.value.envelopePreset === "custom"
    ? form.value.customEnvelopeWidth
    : activeEnvelope.value.widthMm
);

const envelopeHeightMm = computed(() =>
  form.value.envelopePreset === "custom"
    ? form.value.customEnvelopeHeight
    : activeEnvelope.value.heightMm
);

const pageStyle = computed(() => ({
  width: `${paperWidthMm.value}mm`,
  minHeight: `${paperHeightMm.value}mm`
}));

const cardStyle = computed(() => ({
  width: `${Math.max(80, envelopeWidthMm.value)}mm`,
  minHeight: `${Math.max(120, envelopeHeightMm.value)}mm`
}));

const csvText = computed(() => {
  if (!samples.value.length) return "";
  const rows = [
    ["envelope_no", "uuid", "generated_at"],
    ...samples.value.map(item => [item.envelopeNo, item.uuid, generatedAt.value])
  ];
  return rows
    .map(cols =>
      cols
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
});

const formatNow = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
};

const defaultBatchName = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `报销信封批次-${yyyy}${mm}${dd}-${hh}${mi}`;
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

const createEnvelopeNo = (seq: number, when: Date) => {
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const dd = String(when.getDate()).padStart(2, "0");
  return `RM-${yyyy}${mm}${dd}-${String(seq).padStart(4, "0")}`;
};

const persistSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(form.value));
  } catch {
    // ignore local persistence failure
  }
};

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof form.value>;
    form.value = {
      ...form.value,
      ...parsed
    };
  } catch {
    // ignore invalid local persistence
  }
};

const validateForm = () => {
  if (!Number.isFinite(form.value.count) || form.value.count <= 0) {
    message("请输入正确的生成数量", { type: "warning" });
    return false;
  }
  if (form.value.count > 200) {
    message("离线样本建议单次不超过 200 个", { type: "warning" });
    return false;
  }
  if (paperWidthMm.value < 100 || paperHeightMm.value < 100) {
    message("纸张尺寸过小，请重新设置", { type: "warning" });
    return false;
  }
  if (envelopeWidthMm.value < 80 || envelopeHeightMm.value < 120) {
    message("信封尺寸过小，请重新设置", { type: "warning" });
    return false;
  }
  return true;
};

const generateSamples = async () => {
  if (!validateForm()) return;
  generating.value = true;
  try {
    const now = new Date();
    const uuids = Array.from({ length: Math.floor(form.value.count) }, () => createUuid());
    const qrList = await Promise.all(
      uuids.map(uuid =>
        QRCode.toDataURL(uuid, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220
        })
      )
    );
    samples.value = uuids.map((uuid, index) => ({
      envelopeNo: createEnvelopeNo(index + 1, now),
      uuid,
      qrDataUrl: qrList[index]
    }));
    if (!form.value.batchName.trim()) {
      form.value.batchName = defaultBatchName();
    }
    generatedAt.value = formatNow();
    persistSettings();
    message(`已生成 ${samples.value.length} 个信封`, { type: "success" });
  } catch {
    message("生成失败，请重试", { type: "error" });
  } finally {
    generating.value = false;
  }
};

const printSamples = () => {
  if (!samples.value.length) {
    message("请先生成信封", { type: "warning" });
    return;
  }
  window.print();
};

const clearSamples = () => {
  samples.value = [];
  generatedAt.value = "";
};

const downloadCsv = () => {
  if (!samples.value.length || !csvText.value) {
    message("请先生成信封", { type: "warning" });
    return;
  }
  const blob = new Blob([`\uFEFF${csvText.value}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = generatedAt.value.replace(/[\s:]/g, "-");
  a.download = `reimbursement-envelope-${ts || "export"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const buildBatchExport = (): EnvelopeBatchExport => ({
  schemaVersion: 1,
  batchName: form.value.batchName.trim() || defaultBatchName(),
  generatedAt: generatedAt.value || formatNow(),
  paper: { widthMm: paperWidthMm.value, heightMm: paperHeightMm.value },
  envelope: { widthMm: envelopeWidthMm.value, heightMm: envelopeHeightMm.value },
  items: samples.value.map(item => ({ envelopeNo: item.envelopeNo, uuid: item.uuid }))
});

const downloadBatchJson = () => {
  if (!samples.value.length) {
    message("请先生成信封", { type: "warning" });
    return;
  }
  const payload = buildBatchExport();
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = (generatedAt.value || formatNow()).replace(/[\s:]/g, "-");
  a.download = `reimbursement-envelope-${ts || "batch"}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const triggerImport = () => {
  importFileInput.value?.click();
};

const importBatchJson = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<EnvelopeBatchExport>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) {
      throw new Error("invalid_schema");
    }
    const rebuilt = await Promise.all(
      parsed.items.map(async item => ({
        envelopeNo: String(item.envelopeNo || ""),
        uuid: String(item.uuid || ""),
        qrDataUrl: await QRCode.toDataURL(String(item.uuid || ""), {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220
        })
      }))
    );

    samples.value = rebuilt;
    generatedAt.value = typeof parsed.generatedAt === "string" ? parsed.generatedAt : formatNow();
    if (parsed.batchName) {
      form.value.batchName = parsed.batchName;
    }
    if (parsed.paper) {
      form.value.paperPreset = "custom";
      form.value.customPaperWidth = Number(parsed.paper.widthMm || form.value.customPaperWidth);
      form.value.customPaperHeight = Number(parsed.paper.heightMm || form.value.customPaperHeight);
    }
    if (parsed.envelope) {
      form.value.envelopePreset = "custom";
      form.value.customEnvelopeWidth = Number(parsed.envelope.widthMm || form.value.customEnvelopeWidth);
      form.value.customEnvelopeHeight = Number(parsed.envelope.heightMm || form.value.customEnvelopeHeight);
    }
    persistSettings();
    message(`已导入 ${samples.value.length} 个信封`, { type: "success" });
  } catch {
    message("导入失败：请检查 JSON 文件格式", { type: "error" });
  }
};

const backToList = () => {
  router.push("/finance/reimbursement");
};

onMounted(() => {
  loadSettings();
  if (!form.value.batchName.trim()) {
    form.value.batchName = defaultBatchName();
  }
});
</script>

<template>
  <div class="envelope-generator-page">
    <el-card shadow="never" class="screen-only">
      <template #header>
        <div class="title-row">
          <span>信封生成器（正式版，离线）</span>
          <div class="actions">
            <el-button @click="backToList">返回报销处理</el-button>
            <el-button @click="clearSamples">清空结果</el-button>
            <el-button type="primary" :loading="generating" @click="generateSamples">生成信封</el-button>
            <el-button type="success" plain @click="printSamples">打印预览</el-button>
            <el-button type="warning" plain @click="downloadCsv">导出清单CSV</el-button>
            <el-button type="warning" plain @click="downloadBatchJson">导出批次JSON</el-button>
            <el-button plain @click="triggerImport">导入批次JSON</el-button>
          </div>
        </div>
      </template>

      <el-form label-width="110px" class="generator-form">
        <el-form-item label="生成数量" required>
          <el-input-number v-model="form.count" :min="1" :max="200" />
        </el-form-item>

        <el-form-item label="纸张大小" required>
          <div class="inline-pair">
            <el-select v-model="form.paperPreset" style="width: 280px">
              <el-option
                v-for="item in paperPresets"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <template v-if="form.paperPreset === 'custom'">
              <el-input-number v-model="form.customPaperWidth" :min="100" :max="1000" />
              <span>mm ×</span>
              <el-input-number v-model="form.customPaperHeight" :min="100" :max="1000" />
              <span>mm</span>
            </template>
          </div>
        </el-form-item>

        <el-form-item label="信封大小" required>
          <div class="inline-pair">
            <el-select v-model="form.envelopePreset" style="width: 280px">
              <el-option
                v-for="item in envelopePresets"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
            <template v-if="form.envelopePreset === 'custom'">
              <el-input-number v-model="form.customEnvelopeWidth" :min="80" :max="1000" />
              <span>mm ×</span>
              <el-input-number v-model="form.customEnvelopeHeight" :min="120" :max="1000" />
              <span>mm</span>
            </template>
          </div>
        </el-form-item>

        <el-form-item label="标题前缀">
          <el-input v-model="form.labelPrefix" style="width: 320px" />
        </el-form-item>

        <el-form-item label="批次名称">
          <el-input v-model="form.batchName" style="width: 360px" />
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        title="正式离线模式：UUID 与二维码在浏览器端生成，可直接打印；如需入库请后续再接线上写入。"
      />
      <input
        ref="importFileInput"
        type="file"
        accept="application/json,.json"
        class="import-input"
        @change="importBatchJson"
      />
    </el-card>

    <div v-if="samples.length" class="preview-sheet" :style="pageStyle">
      <div class="sheet-meta">生成时间：{{ generatedAt }}</div>
      <div class="sheet-meta">批次名称：{{ form.batchName }}</div>
      <div class="cards-grid">
        <div v-for="(item, idx) in samples" :key="item.uuid" class="envelope-card" :style="cardStyle">
          <div class="card-head">{{ form.labelPrefix || "报销信封" }} {{ idx + 1 }}</div>
          <div class="envelope-no">信封编号：{{ item.envelopeNo }}</div>
          <div class="card-body">
            <img class="qr" :src="item.qrDataUrl" alt="envelope-uuid-qrcode" />
            <div class="uuid-text">{{ item.uuid }}</div>
            <div class="fill-line">封装时间：________________</div>
            <div class="fill-line">签收时间：________________</div>
            <div class="fill-line">填 报 人：________________</div>
          </div>
        </div>
      </div>
    </div>

    <el-empty
      v-else
      description="尚未生成信封，请先设置参数并点击“生成信封”"
      class="screen-only empty-state"
    />
  </div>
</template>

<style scoped>
.envelope-generator-page {
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
}

.generator-form {
  margin-bottom: 12px;
}

.inline-pair {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.preview-sheet {
  background: #fff;
  margin: 0 auto;
  padding: 8mm;
  box-shadow: 0 6px 24px rgb(29 28 38 / 12%);
}

.sheet-meta {
  margin-bottom: 8mm;
  color: #675f55;
  font-size: 12px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92mm, 1fr));
  gap: 8mm;
}

.envelope-card {
  border: 1px solid #2f2f2f;
  padding: 5mm;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.card-head {
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  margin-bottom: 4mm;
}

.card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4mm;
}

.envelope-no {
  text-align: center;
  font-size: 12px;
  color: #4d463f;
  margin-bottom: 2mm;
}

.qr {
  width: 42mm;
  height: 42mm;
  object-fit: contain;
  border: 1px solid #e0e0e0;
}

.uuid-text {
  font-size: 11px;
  word-break: break-all;
  text-align: center;
}

.fill-line {
  width: 100%;
  font-size: 12px;
}

.empty-state {
  background: #fff;
  border-radius: 8px;
}

.import-input {
  display: none;
}

@media print {
  .screen-only {
    display: none !important;
  }

  .preview-sheet {
    width: auto !important;
    min-height: auto !important;
    box-shadow: none;
    margin: 0;
    padding: 0;
  }
}
</style>
