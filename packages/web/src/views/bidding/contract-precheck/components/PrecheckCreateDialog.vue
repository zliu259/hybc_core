<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ElMessage,
  type UploadProps,
  type UploadRequestOptions
} from "element-plus";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { formatToken, getToken } from "@/utils/auth";
import { parseFile } from "@/views/bidding/dedup/lib/doc-parser";
import type { CreatePrecheckPayload } from "@/api/contract-precheck";

defineOptions({ name: "PrecheckCreateDialog" });

const props = defineProps<{
  visible: boolean;
  /** 复审模式：只收文件，不收标题/方向 */
  reviewOnly?: boolean;
  submitting?: boolean;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", payload: CreatePrecheckPayload): void;
}>();

const MAX_TEXT = 150_000;
const SUPPORTED_EXT_RE = /\.(docx|pdf|jpg|jpeg|png)$/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png)$/i;
const PDF_EXT_RE = /\.pdf$/i;
const NO_TEXT_LAYER_RE = /无文字层/;

const form = ref({
  title: "",
  direction: "inbound" as "inbound" | "outbound",
  counterparty: ""
});
const parsing = ref(false);
// 覆盖 sign+PUT 上传窗口的本地防重锁：父组件 submitting 只在 emit 之后才生效
const uploading = ref(false);
const parsedText = ref("");
// 扫描件/图片：浏览器无法本地提取文字，上传原件由服务端 OCR 转写后再审计
const serverExtract = ref(false);
const pickedFile = ref<File | null>(null);
const parseError = ref("");

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value)
});

const resetState = () => {
  form.value = { title: "", direction: "inbound", counterparty: "" };
  parsedText.value = "";
  serverExtract.value = false;
  pickedFile.value = null;
  parseError.value = "";
};

const fillTitleFromFile = (file: File) => {
  if (!props.reviewOnly && !form.value.title) {
    form.value.title = file.name
      .replace(/\.(docx|pdf|jpg|jpeg|png)$/i, "")
      .slice(0, 120);
  }
};

/** 选择/拖拽共用：能本地解析则解析，扫描件/图片降级为服务端 OCR */
const acceptFile = async (file: File) => {
  parsing.value = true;
  parseError.value = "";
  parsedText.value = "";
  serverExtract.value = false;
  pickedFile.value = null;
  try {
    // 前置扩展名校验：共用的 doc-parser 报错文案未覆盖本模块新增的图片支持
    if (!SUPPORTED_EXT_RE.test(file.name)) {
      throw new Error(
        `不支持的文件格式：${file.name}（支持 .docx / .pdf / 合同照片 .jpg .png）`
      );
    }
    // 图片（合同拍照/单页扫描）：直接走服务端 OCR
    if (IMAGE_EXT_RE.test(file.name)) {
      serverExtract.value = true;
      pickedFile.value = file;
      fillTitleFromFile(file);
      return;
    }
    const paragraphs = await parseFile(file);
    const text = paragraphs.join("\n").trim();
    if (text.length > MAX_TEXT) {
      throw new Error(
        `合同文本过长（${text.length} 字符，上限 ${MAX_TEXT}），请拆分后分别预审`
      );
    }
    if (text.length < 50) {
      // 文字层过短的 PDF（扫描仪只嵌了页码/日期戳）：与无文字层同路径交服务端 OCR
      if (PDF_EXT_RE.test(file.name)) {
        serverExtract.value = true;
        pickedFile.value = file;
        fillTitleFromFile(file);
        return;
      }
      throw new Error("提取到的文本过短，请确认文件内容完整");
    }
    parsedText.value = text;
    pickedFile.value = file;
    fillTitleFromFile(file);
  } catch (e) {
    const message = e instanceof Error ? e.message : "文件解析失败";
    // 无文字层的扫描版 PDF：不拦截，改由服务端 OCR 转写（上限 20 页）
    if (NO_TEXT_LAYER_RE.test(message)) {
      serverExtract.value = true;
      pickedFile.value = file;
      fillTitleFromFile(file);
      return;
    }
    parseError.value = message;
  } finally {
    parsing.value = false;
  }
};

/**
 * el-upload 拖拽/点击选择的统一入口：覆写 http-request 接管上传行为——
 * 此处只做本地解析，真正的 R2 上传在提交时（onSubmit）走签名直传。
 */
const onUploadRequest = (options: UploadRequestOptions) => {
  void acceptFile(options.file as File);
  return Promise.resolve();
};

const onExceed: UploadProps["onExceed"] = files => {
  if (files[0]) void acceptFile(files[0] as File);
};

const canSubmit = computed(() => {
  if (!pickedFile.value) return false;
  if (!parsedText.value && !serverExtract.value) return false;
  if (props.reviewOnly) return true;
  return form.value.title.trim().length > 0;
});

const onSubmit = async () => {
  const file = pickedFile.value;
  if (!file || uploading.value) return;
  if (!parsedText.value && !serverExtract.value) return;
  uploading.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      category: "contract-precheck"
    });
    const putRes = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: { Authorization: formatToken(getToken().accessToken) },
      body: file
    });
    if (!putRes.ok) throw new Error(`原件上传失败（${putRes.status}）`);
    emit("submit", {
      title: form.value.title.trim(),
      direction: form.value.direction,
      counterparty: form.value.counterparty.trim() || undefined,
      file_key: signRes.data.key,
      file_name: file.name,
      file_size: file.size,
      // 空文本 = 服务端提取路径（扫描件由 runner OCR 转写后再审计）
      contract_text: serverExtract.value ? "" : parsedText.value
    });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "上传失败，请重试");
  } finally {
    uploading.value = false;
  }
};

defineExpose({ resetState });
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="reviewOnly ? '上传新版本复审' : '新建合同预审'"
    width="560px"
    @closed="resetState"
  >
    <el-form label-width="90px">
      <template v-if="!reviewOnly">
        <el-form-item label="合同标题" required>
          <el-input
            v-model="form.title"
            maxlength="120"
            placeholder="如：顶管机租赁合同（XX项目）"
          />
        </el-form-item>
        <el-form-item label="我方立场" required>
          <el-radio-group v-model="form.direction">
            <el-radio value="inbound">收款合同（我方乙方）</el-radio>
            <el-radio value="outbound">付款合同（我方甲方）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="对方主体">
          <el-input
            v-model="form.counterparty"
            maxlength="120"
            placeholder="对方公司全称（转入合同时必填，可后补）"
          />
        </el-form-item>
      </template>
      <el-form-item label="合同文件" required>
        <div class="upload-block">
          <el-upload
            drag
            action="#"
            :accept="'.docx,.pdf,.jpg,.jpeg,.png'"
            :limit="1"
            :show-file-list="false"
            :disabled="parsing || uploading"
            :http-request="onUploadRequest"
            :on-exceed="onExceed"
          >
            <div class="drop-inner">
              <div class="drop-title">
                将合同文件拖到此处，或<em>点击选择</em>
              </div>
              <div class="drop-sub">
                支持 .docx / 电子版 .pdf / 扫描版 .pdf / 合同照片(.jpg .png)
              </div>
            </div>
          </el-upload>
          <div class="upload-hint">
            电子版在浏览器本地提取文本；扫描件与照片由服务端 OCR 识别（上限 20
            页，审计前多等 1-2 分钟）；重新拖入可替换文件
          </div>
          <el-alert
            v-if="parseError"
            type="error"
            :title="parseError"
            :closable="false"
            style="margin-top: 6px"
          />
          <el-alert
            v-else-if="serverExtract"
            type="info"
            :title="`已选择扫描件 ${pickedFile?.name}：提交后由服务端 OCR 识别文字再审计`"
            :closable="false"
            style="margin-top: 6px"
          />
          <el-alert
            v-else-if="parsedText"
            type="success"
            :title="`已解析 ${pickedFile?.name}（约 ${parsedText.length} 字符）`"
            :closable="false"
            style="margin-top: 6px"
          />
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="parsing || uploading || submitting"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        {{ reviewOnly ? "上传并复审" : "创建并开始预审" }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.upload-block {
  width: 100%;
}
.upload-block :deep(.el-upload),
.upload-block :deep(.el-upload-dragger) {
  width: 100%;
}
.upload-block :deep(.el-upload-dragger) {
  padding: 18px 12px;
}
.drop-inner {
  line-height: 1.6;
}
.drop-title {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.drop-title em {
  font-style: normal;
  color: var(--el-color-primary);
}
.drop-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.upload-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
