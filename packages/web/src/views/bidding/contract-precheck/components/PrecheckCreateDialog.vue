<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
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

const form = ref({
  title: "",
  direction: "inbound" as "inbound" | "outbound",
  counterparty: ""
});
const parsing = ref(false);
// 覆盖 sign+PUT 上传窗口的本地防重锁：父组件 submitting 只在 emit 之后才生效
const uploading = ref(false);
const parsedText = ref("");
const pickedFile = ref<File | null>(null);
const parseError = ref("");

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value)
});

const resetState = () => {
  form.value = { title: "", direction: "inbound", counterparty: "" };
  parsedText.value = "";
  pickedFile.value = null;
  parseError.value = "";
};

const onFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  parsing.value = true;
  parseError.value = "";
  parsedText.value = "";
  pickedFile.value = null;
  try {
    const paragraphs = await parseFile(file);
    const text = paragraphs.join("\n").trim();
    if (text.length > MAX_TEXT) {
      throw new Error(
        `合同文本过长（${text.length} 字符，上限 ${MAX_TEXT}），请拆分后分别预审`
      );
    }
    if (text.length < 50) {
      throw new Error("提取到的文本过短，请确认文件内容完整");
    }
    parsedText.value = text;
    pickedFile.value = file;
    if (!props.reviewOnly && !form.value.title) {
      form.value.title = file.name.replace(/\.(docx|pdf)$/i, "").slice(0, 120);
    }
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : "文件解析失败";
  } finally {
    parsing.value = false;
  }
};

const canSubmit = computed(() => {
  if (!pickedFile.value || !parsedText.value) return false;
  if (props.reviewOnly) return true;
  return form.value.title.trim().length > 0;
});

const onSubmit = async () => {
  const file = pickedFile.value;
  if (!file || !parsedText.value || uploading.value) return;
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
      contract_text: parsedText.value
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
          <input
            type="file"
            accept=".docx,.pdf"
            :disabled="parsing"
            @change="onFileChange"
          />
          <div class="upload-hint">
            支持 .docx 与电子版
            .pdf（扫描件暂不支持）；文本在浏览器本地提取后随原件一并提交
          </div>
          <el-alert
            v-if="parseError"
            type="error"
            :title="parseError"
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
.upload-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
