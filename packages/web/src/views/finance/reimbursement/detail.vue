<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature } from "@/api/upload";
import {
  createReimbursementEnvelope,
  getEnvelopeAnomalyStatus,
  getEnvelopeOcrStatus,
  getEnvelopePdfStatus,
  getReimbursementEnvelope,
  precheckEnvelope,
  scanReimbursementEnvelope,
  triggerEnvelopeAnomalyCheck,
  triggerEnvelopePdf,
  updateReimbursementEnvelope,
  verifyReimbursementEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "ReimbursementDetail" });

const route = useRoute();
const router = useRouter();

const envelopeId = computed(() => Number(route.params.id));
const isCreate = computed(() => route.params.id === "create");

const loading = ref(false);
const saving = ref(false);
const detail = ref<ReimbursementEnvelopeDetail | null>(null);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const form = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  channel: "physical" as "physical" | "electronic",
  invoice_no: "",
  expense_date: "",
  amount: 0,
  category: "",
  description: ""
});

type EnvelopeAttachmentDraft = {
  id?: number;
  attachment_type: string;
  file_key: string;
  file_name: string;
  file_size?: number | null;
  created_at?: string;
  is_new?: boolean;
};

const attachmentItems = ref<EnvelopeAttachmentDraft[]>([]);
const uploadingAttachment = ref(false);
const attachmentType = ref("invoice");

const editableStatuses = new Set(["draft", "submitted"]);
const canEdit = computed(() => {
  if (isCreate.value) return true;
  if (!detail.value) return false;
  return editableStatuses.has(detail.value.status);
});

const uuidLocked = computed(() => {
  if (isCreate.value) return false;
  if (!detail.value) return false;
  return attachmentItems.value.length > 0 || detail.value.status !== "draft";
});

const attachmentTypeOptions = [
  { label: "发票", value: "invoice" },
  { label: "凭证", value: "receipt" },
  { label: "合同", value: "contract" },
  { label: "其他", value: "other" }
];

const attachmentUrl = (fileKey: string) =>
  `/api/v1/upload/object/${encodeURIComponent(fileKey)}`;

const stagedAttachmentsForSubmit = () =>
  attachmentItems.value
    .filter(item => item.is_new)
    .map(item => ({
      attachment_type: item.attachment_type || "invoice",
      file_key: item.file_key,
      file_name: item.file_name || undefined,
      file_size: item.file_size ?? undefined
    }));

const verifyNote = ref("");
const ocrStatusText = ref("none");
const anomalyStatusText = ref("none");

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getReimbursementEnvelope(envelopeId.value);
    detail.value = result.data;
    form.value = {
      project_id: result.data.project_id,
      applicant_userid: result.data.applicant_userid,
      channel: result.data.channel,
      invoice_no: result.data.invoice_no || "",
      expense_date: result.data.expense_date || "",
      amount: result.data.amount,
      category: result.data.category || "",
      description: result.data.description || ""
    };

    attachmentItems.value = (result.data.attachments || []).map(item => ({
      id: item.id,
      attachment_type: item.attachment_type || "invoice",
      file_key: item.file_key,
      file_name: item.file_name || item.file_key,
      file_size: item.file_size,
      created_at: item.created_at,
      is_new: false
    }));

    ocrStatusText.value = result.data.ocr_status || "none";
    anomalyStatusText.value = result.data.duplicate_check_status || "none";
  } finally {
    loading.value = false;
  }
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  if (!canEdit.value) {
    message("当前状态不允许上传附件", { type: "warning" });
    options.onError?.(new Error("upload_not_allowed") as never);
    return;
  }

  const rawFile = options.file;
  uploadingAttachment.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "reimbursement"
    });

    const uploadResp = await fetch(signRes.data.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    attachmentItems.value.unshift({
      attachment_type: attachmentType.value,
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size,
      is_new: true
    });

    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingAttachment.value = false;
  }
};

const removeStagedAttachment = (index: number) => {
  const target = attachmentItems.value[index];
  if (!target) return;
  if (!target.is_new) {
    message("已入库附件不支持在此页面删除", { type: "info" });
    return;
  }
  attachmentItems.value.splice(index, 1);
};

const save = async () => {
  if (!form.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }

  const attachments = stagedAttachmentsForSubmit();

  saving.value = true;
  try {
    if (isCreate.value) {
      const result = await createReimbursementEnvelope({
        project_id: form.value.project_id,
        applicant_userid: form.value.applicant_userid || undefined,
        channel: form.value.channel,
        invoice_no: form.value.invoice_no || undefined,
        expense_date: form.value.expense_date || undefined,
        amount: form.value.amount,
        category: form.value.category || undefined,
        description: form.value.description || undefined,
        attachments: attachments.length > 0 ? attachments : undefined
      });
      message("创建成功", { type: "success" });
      router.replace(`/finance/reimbursement/detail/${result.data.id}`);
    } else {
      await updateReimbursementEnvelope(envelopeId.value, {
        project_id: form.value.project_id,
        applicant_userid: form.value.applicant_userid || undefined,
        channel: form.value.channel,
        invoice_no: form.value.invoice_no || undefined,
        expense_date: form.value.expense_date || undefined,
        amount: form.value.amount,
        category: form.value.category || undefined,
        description: form.value.description || undefined,
        attachments: attachments.length > 0 ? attachments : undefined
      });
      message("保存成功", { type: "success" });
      await loadDetail();
    }
  } finally {
    saving.value = false;
  }
};

const scanSubmit = async () => {
  if (!detail.value) return;
  await scanReimbursementEnvelope({
    envelope_uuid: detail.value.envelope_uuid,
    project_id: form.value.project_id,
    invoice_no: form.value.invoice_no || undefined,
    expense_date: form.value.expense_date || undefined,
    amount: form.value.amount,
    category: form.value.category || undefined,
    description: form.value.description || undefined
  });
  message("扫码填报完成", { type: "success" });
  await loadDetail();
};

const verify = async (result: "verified" | "mismatch") => {
  if (!detail.value) return;
  await verifyReimbursementEnvelope({
    envelope_id: detail.value.id,
    result,
    note: verifyNote.value || undefined
  });
  message(result === "verified" ? "收件核对通过" : "已标记核对异常", {
    type: result === "verified" ? "success" : "warning"
  });
  await loadDetail();
};

const generatePdf = async () => {
  if (!detail.value) return;
  await triggerEnvelopePdf(detail.value.id);
  message("已触发 PDF 生成任务", { type: "success" });
  await loadDetail();
};

const refreshPdfStatus = async () => {
  if (!detail.value) return;
  const result = await getEnvelopePdfStatus(detail.value.id);
  message(`PDF状态：${result.data.status}`, { type: "info" });
  await loadDetail();
};

const refreshOcrStatus = async () => {
  if (!detail.value) return;
  const result = await getEnvelopeOcrStatus(detail.value.id);
  ocrStatusText.value = result.data.status;
  message(
    `OCR状态：${result.data.status}，查重线索：${result.data.duplicate_count}`,
    {
      type: "info"
    }
  );
  await loadDetail();
};

const triggerAnomaly = async () => {
  if (!detail.value) return;
  await triggerEnvelopeAnomalyCheck(detail.value.id);
  message("已触发异常检测任务", { type: "success" });
};

const refreshAnomalyStatus = async () => {
  if (!detail.value) return;
  const result = await getEnvelopeAnomalyStatus(detail.value.id);
  anomalyStatusText.value = result.data.status;
  message(
    `异常检测状态：${result.data.status}（预审状态：${result.data.precheck_status}）`,
    {
      type: "info"
    }
  );
  await loadDetail();
};

const submitPrecheck = async (
  action: "approved" | "supplement" | "rejected"
) => {
  if (!detail.value) return;
  await precheckEnvelope(detail.value.id, {
    action,
    comment: verifyNote.value || undefined
  });
  message(`预审已更新：${action}`, {
    type: action === "approved" ? "success" : "warning"
  });
  await loadDetail();
};

onMounted(async () => {
  await Promise.all([loadProjects(), loadWecomUsers()]);
  await loadDetail();
});

watch(
  () => route.params.id,
  async () => {
    await loadDetail();
  }
);
</script>

<template>
  <el-card shadow="never" :loading="loading" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>{{
          isCreate ? "新建报销信封" : `信封详情 - ${detail?.envelope_no || ""}`
        }}</span>
        <el-button @click="router.push('/finance/reimbursement')"
          >返回</el-button
        >
      </div>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :md="16">
        <el-card shadow="never" header="基础信息">
          <el-form label-width="100px">
            <el-form-item label="所属项目" required>
              <el-select
                v-model="form.project_id"
                filterable
                placeholder="请选择项目"
                style="width: 320px"
                :disabled="!canEdit"
              >
                <el-option
                  v-for="item in projects"
                  :key="item.id"
                  :label="item.project_name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="填报人">
              <el-select
                v-model="form.applicant_userid"
                clearable
                filterable
                placeholder="留空默认当前登录人"
                style="width: 360px"
                :disabled="!canEdit"
              >
                <el-option
                  v-for="item in wecomUsers"
                  :key="item.userid"
                  :label="`${item.name} (${item.userid})`"
                  :value="item.userid"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="通道">
              <el-select v-model="form.channel" style="width: 200px" :disabled="!canEdit">
                <el-option label="实物信封" value="physical" />
                <el-option label="电子发票" value="electronic" />
              </el-select>
            </el-form-item>

            <el-form-item label="发票号">
              <el-input v-model="form.invoice_no" style="width: 320px" :disabled="!canEdit" />
            </el-form-item>

            <el-form-item label="费用日期">
              <el-date-picker
                v-model="form.expense_date"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 220px"
                :disabled="!canEdit"
              />
            </el-form-item>

            <el-form-item label="金额">
              <el-input-number
                v-model="form.amount"
                :min="0"
                :precision="2"
                :step="100"
                :disabled="!canEdit"
              />
            </el-form-item>

            <el-form-item label="费用类别">
              <el-input v-model="form.category" style="width: 320px" :disabled="!canEdit" />
            </el-form-item>

            <el-form-item label="说明">
              <el-input
                v-model="form.description"
                type="textarea"
                :rows="3"
                style="width: 560px"
                :disabled="!canEdit"
              />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="8">
        <el-card shadow="never" header="信封标识">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="信封编号">{{ detail?.envelope_no || "保存后生成" }}</el-descriptions-item>
            <el-descriptions-item label="信封UUID">{{ detail?.envelope_uuid || "保存后生成" }}</el-descriptions-item>
            <el-descriptions-item label="UUID状态">
              <el-tag :type="uuidLocked ? 'warning' : 'success'">{{ uuidLocked ? "已锁定" : "未锁定" }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="说明">
              上传任一附件后，UUID 不允许再修改
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card shadow="never" header="状态总览" class="mt-3">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="状态">{{ detail?.status || "draft" }}</el-descriptions-item>
            <el-descriptions-item label="核对状态">{{ detail?.verification_status || "pending" }}</el-descriptions-item>
            <el-descriptions-item label="预审状态">{{ detail?.precheck_status || "none" }}</el-descriptions-item>
            <el-descriptions-item label="PDF状态">{{ detail?.pdf_status || "none" }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" header="附件（拖拽上传）" class="mt-3">
      <el-space wrap class="mb-3">
        <el-select v-model="attachmentType" style="width: 180px" :disabled="!canEdit || uploadingAttachment">
          <el-option
            v-for="item in attachmentTypeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-tag type="info">仅新增附件可在保存前移除</el-tag>
      </el-space>

      <el-upload
        drag
        action="#"
        :show-file-list="false"
        :disabled="!canEdit || uploadingAttachment"
        :http-request="uploadAttachment"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
      >
        <div class="el-upload__text">拖拽文件到这里，或 <em>点击上传</em></div>
        <template #tip>
          <div class="el-upload__tip">支持 PDF / 图片，上传后将进入附件列表</div>
        </template>
      </el-upload>

      <el-table :data="attachmentItems" size="small" style="margin-top: 12px">
        <el-table-column label="类型" width="120">
          <template #default="scope">
            <el-tag size="small">{{ scope.row.attachment_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="文件名" min-width="260">
          <template #default="scope">
            <el-link :href="attachmentUrl(scope.row.file_key)" target="_blank" type="primary">
              {{ scope.row.file_name }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="120">
          <template #default="scope">{{ scope.row.file_size || "-" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope">
            <el-tag :type="scope.row.is_new ? 'success' : 'info'" size="small">
              {{ scope.row.is_new ? "待保存" : "已入库" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button link type="danger" :disabled="!scope.row.is_new" @click="removeStagedAttachment(scope.$index)">
              移除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" header="操作区" class="mt-3">
      <el-space wrap>
        <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="save">保存</el-button>

        <template v-if="!isCreate && detail">
          <el-button @click="scanSubmit">扫码填报(模拟)</el-button>
          <el-input
            v-model="verifyNote"
            style="width: 220px"
            placeholder="核对备注(可选)"
          />
          <el-button type="success" @click="verify('verified')">收件通过</el-button>
          <el-button type="warning" @click="verify('mismatch')">收件异常</el-button>
          <el-button @click="generatePdf">生成PDF</el-button>
          <el-button @click="refreshPdfStatus">刷新PDF状态</el-button>
          <el-button @click="refreshOcrStatus">刷新OCR状态</el-button>
          <el-button @click="triggerAnomaly">触发异常检测</el-button>
          <el-button @click="refreshAnomalyStatus">刷新异常状态</el-button>
          <el-button type="success" @click="submitPrecheck('approved')">预审通过</el-button>
          <el-button type="warning" @click="submitPrecheck('supplement')">补充材料</el-button>
          <el-button type="danger" @click="submitPrecheck('rejected')">预审驳回</el-button>
        </template>
      </el-space>
    </el-card>

    <el-descriptions v-if="detail" :column="2" border style="margin-top: 16px">
      <el-descriptions-item label="状态">{{
        detail.status
      }}</el-descriptions-item>
      <el-descriptions-item label="核对状态">{{
        detail.verification_status
      }}</el-descriptions-item>
      <el-descriptions-item label="预审状态">{{
        detail.precheck_status
      }}</el-descriptions-item>
      <el-descriptions-item label="PDF状态">{{
        detail.pdf_status
      }}</el-descriptions-item>
      <el-descriptions-item label="PDF文件">{{
        detail.pdf_file_key || "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="批次">{{
        detail.batch?.batch_no || "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="OCR状态">{{
        ocrStatusText
      }}</el-descriptions-item>
      <el-descriptions-item label="异常检测">{{
        anomalyStatusText
      }}</el-descriptions-item>
    </el-descriptions>

    <el-table
      v-if="detail && detail.duplicate_checks.length > 0"
      :data="detail.duplicate_checks"
      style="margin-top: 16px"
      size="small"
    >
      <el-table-column prop="match_type" label="匹配类型" width="120" />
      <el-table-column prop="risk_level" label="风险等级" width="100" />
      <el-table-column
        prop="matched_invoice_no"
        label="匹配发票号"
        width="200"
      />
      <el-table-column prop="summary" label="说明" min-width="240" />
    </el-table>
  </el-card>
</template>
