<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
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
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "ReimbursementDetail" });

const route = useRoute();
const router = useRouter();

const envelopeId = computed(() => Number(route.params.id));
const isCreate = computed(() => route.params.id === "create");

const loading = ref(false);
const saving = ref(false);
const detail = ref<ReimbursementEnvelopeDetail | null>(null);
const projects = ref<Project[]>([]);

const form = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  channel: "physical" as "physical" | "electronic",
  invoice_no: "",
  expense_date: "",
  amount: 0,
  category: "",
  description: "",
  attachments_json: "[]"
});

const verifyNote = ref("");
const ocrStatusText = ref("none");
const anomalyStatusText = ref("none");

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

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
      description: result.data.description || "",
      attachments_json: JSON.stringify(result.data.attachments || [], null, 2)
    };
  } finally {
    loading.value = false;
  }
};

const parseAttachments = () => {
  const trimmed = form.value.attachments_json.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  if (!Array.isArray(parsed)) {
    throw new Error("attachments 必须为数组");
  }
  return parsed;
};

const save = async () => {
  if (!form.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }

  let attachments: ReturnType<typeof parseAttachments>;
  try {
    attachments = parseAttachments();
  } catch (err) {
    message((err as Error).message, { type: "error" });
    return;
  }

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
        attachments
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
        attachments
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
  await loadProjects();
  await loadDetail();
});
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

    <el-form label-width="120px" style="max-width: 860px">
      <el-form-item v-if="!isCreate" label="信封 UUID">
        <el-input :model-value="detail?.envelope_uuid || '-'" readonly />
      </el-form-item>

      <el-form-item label="所属项目" required>
        <el-select
          v-model="form.project_id"
          filterable
          placeholder="请选择项目"
          style="width: 320px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="填报人 userid">
        <el-input
          v-model="form.applicant_userid"
          placeholder="留空默认当前登录人"
          style="width: 320px"
        />
      </el-form-item>

      <el-form-item label="通道">
        <el-select v-model="form.channel" style="width: 200px">
          <el-option label="实物信封" value="physical" />
          <el-option label="电子发票" value="electronic" />
        </el-select>
      </el-form-item>

      <el-form-item label="发票号">
        <el-input v-model="form.invoice_no" style="width: 320px" />
      </el-form-item>

      <el-form-item label="费用日期">
        <el-date-picker
          v-model="form.expense_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          style="width: 220px"
        />
      </el-form-item>

      <el-form-item label="金额">
        <el-input-number
          v-model="form.amount"
          :min="0"
          :precision="2"
          :step="100"
        />
      </el-form-item>

      <el-form-item label="费用类别">
        <el-input v-model="form.category" style="width: 320px" />
      </el-form-item>

      <el-form-item label="说明">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          style="width: 560px"
        />
      </el-form-item>

      <el-form-item label="附件(JSON)">
        <el-input
          v-model="form.attachments_json"
          type="textarea"
          :rows="6"
          style="width: 560px"
          placeholder='例如 [{"file_key":"reimbursement/a.jpg","attachment_type":"invoice"}]'
        />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >

        <template v-if="!isCreate && detail">
          <el-button @click="scanSubmit">扫码填报(模拟)</el-button>
          <el-input
            v-model="verifyNote"
            style="width: 220px; margin-left: 8px"
            placeholder="核对备注(可选)"
          />
          <el-button type="success" @click="verify('verified')"
            >收件通过</el-button
          >
          <el-button type="warning" @click="verify('mismatch')"
            >收件异常</el-button
          >
          <el-button @click="generatePdf">生成PDF</el-button>
          <el-button @click="refreshPdfStatus">刷新PDF状态</el-button>
          <el-button @click="refreshOcrStatus">刷新OCR状态</el-button>
          <el-button @click="triggerAnomaly">触发异常检测</el-button>
          <el-button @click="refreshAnomalyStatus">刷新异常状态</el-button>
          <el-button type="success" @click="submitPrecheck('approved')"
            >预审通过</el-button
          >
          <el-button type="warning" @click="submitPrecheck('supplement')"
            >补充材料</el-button
          >
          <el-button type="danger" @click="submitPrecheck('rejected')"
            >预审驳回</el-button
          >
        </template>
      </el-form-item>
    </el-form>

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
