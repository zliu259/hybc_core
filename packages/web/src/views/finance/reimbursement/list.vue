<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { listProjects, type Project } from "@/api/project";
import {
  batchGenerateReimbursementEnvelopes,
  getEnvelopeOcrStatus,
  listReimbursementEnvelopes,
  resolveReimbursementEnvelopeByUuid,
  uploadElectronicInvoice,
  type ReimbursementEnvelope
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementList" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const router = useRouter();
const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  status: "",
  channel: "",
  keyword: ""
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const statusTagType: Record<string, TagType> = {
  unregistered: "info",
  draft: "info",
  submitted: "warning",
  received: "success",
  batched: "primary",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger"
};

const pdfTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const generateDialogVisible = ref(false);
const generating = ref(false);
const batchForm = ref({
  project_id: undefined as number | undefined,
  count: 10
});

const electronicDialogVisible = ref(false);
const uploadingElectronic = ref(false);
const quickScanDialogVisible = ref(false);
const quickScanUuid = ref("");
const electronicForm = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  file_key: "",
  file_name: "",
  file_size: undefined as number | undefined,
  invoice_no: "",
  amount: undefined as number | undefined,
  issue_date: "",
  description: ""
});

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      status: filters.value.status || undefined,
      channel: filters.value.channel || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const goCreate = () => {
  router.push("/finance/reimbursement/detail/create");
};

const goDetail = (id: number) => {
  router.push(`/finance/reimbursement/detail/${id}`);
};

const goPrecheckWorkbench = () => {
  router.push("/finance/reimbursement/precheck");
};

const goDuplicateCenter = () => {
  router.push("/finance/reimbursement/duplicate");
};

const goBatchCenter = () => {
  router.push("/finance/reimbursement/batch");
};

const openBatchGenerate = () => {
  batchForm.value = {
    project_id: filters.value.project_id,
    count: 10
  };
  generateDialogVisible.value = true;
};

const submitBatchGenerate = async () => {
  if (!batchForm.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }
  generating.value = true;
  try {
    const result = await batchGenerateReimbursementEnvelopes({
      project_id: batchForm.value.project_id,
      count: batchForm.value.count
    });
    message(`已生成 ${result.data.length} 个报销信封`, { type: "success" });
    generateDialogVisible.value = false;
    await loadData();
  } finally {
    generating.value = false;
  }
};

const openElectronicUpload = () => {
  electronicForm.value = {
    project_id: filters.value.project_id,
    applicant_userid: "",
    file_key: "",
    file_name: "",
    file_size: undefined,
    invoice_no: "",
    amount: undefined,
    issue_date: "",
    description: ""
  };
  electronicDialogVisible.value = true;
};

const openQuickScan = () => {
  quickScanUuid.value = "";
  quickScanDialogVisible.value = true;
};

const submitQuickScan = async () => {
  if (!quickScanUuid.value.trim()) {
    message("请填写信封UUID", { type: "warning" });
    return;
  }
  const result = await resolveReimbursementEnvelopeByUuid(quickScanUuid.value.trim());
  message("已打开对应报销信封", { type: "success" });
  quickScanDialogVisible.value = false;
  goDetail(result.data.id);
};

const submitElectronicUpload = async () => {
  if (!electronicForm.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }
  if (!electronicForm.value.file_key.trim()) {
    message("请填写 file_key", { type: "warning" });
    return;
  }

  uploadingElectronic.value = true;
  try {
    const result = await uploadElectronicInvoice({
      project_id: electronicForm.value.project_id,
      applicant_userid: electronicForm.value.applicant_userid || undefined,
      file_key: electronicForm.value.file_key,
      file_name: electronicForm.value.file_name || undefined,
      file_size: electronicForm.value.file_size,
      invoice_no: electronicForm.value.invoice_no || undefined,
      amount: electronicForm.value.amount,
      issue_date: electronicForm.value.issue_date || undefined,
      description: electronicForm.value.description || undefined
    });

    const ocr = await getEnvelopeOcrStatus(result.data.id);
    message(`电子发票已入池，OCR状态：${ocr.data.status}`, { type: "success" });
    electronicDialogVisible.value = false;
    await loadData();
  } finally {
    uploadingElectronic.value = false;
  }
};

onMounted(async () => {
  await loadProjects();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <el-form inline>
      <el-form-item label="所属项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 170px">
          <el-option label="草稿" value="draft" />
          <el-option label="未登记" value="unregistered" />
          <el-option label="已填报" value="submitted" />
          <el-option label="已收件" value="received" />
          <el-option label="已成批" value="batched" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已放款" value="paid" />
          <el-option label="已拒绝" value="rejected" />
        </el-select>
      </el-form-item>
      <el-form-item label="通道">
        <el-select v-model="filters.channel" clearable style="width: 160px">
          <el-option label="实物信封" value="physical" />
          <el-option label="电子发票" value="electronic" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编号/UUID/发票号"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
      <el-button @click="openElectronicUpload">电子发票上传</el-button>
      <el-button @click="openQuickScan">扫码/输入UUID打开信封</el-button>
      <el-button @click="openBatchGenerate">批量生成信封（未登记）</el-button>
      <el-button @click="goPrecheckWorkbench">预审工作台</el-button>
      <el-button @click="goDuplicateCenter">查重中心</el-button>
      <el-button @click="goBatchCenter">集中审批</el-button>
      <el-button type="success" @click="goCreate">新建信封</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="envelope_no" label="信封编号" width="150" />
      <el-table-column prop="envelope_uuid" label="UUID" min-width="240" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="填报人" width="140" />
      <el-table-column prop="amount" label="金额" width="100" />
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="statusTagType[scope.row.status] || 'info'">{{
            scope.row.status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="PDF" width="110">
        <template #default="scope">
          <el-tag :type="pdfTagType[scope.row.pdf_status] || 'info'">{{
            scope.row.pdf_status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>

  <el-dialog v-model="generateDialogVisible" title="批量生成信封" width="520px">
    <el-form label-width="110px">
      <el-form-item label="所属项目" required>
        <el-select
          v-model="batchForm.project_id"
          filterable
          placeholder="请选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="生成数量" required>
        <el-input-number v-model="batchForm.count" :min="1" :max="200" />
      </el-form-item>
      <el-alert
        type="info"
        :closable="false"
        title="批量生成后信封为“未登记”，需报销人扫码后才会注册并绑定填报人。"
      />
    </el-form>
    <template #footer>
      <el-button @click="generateDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="generating"
        @click="submitBatchGenerate"
        >确认生成</el-button
      >
    </template>
  </el-dialog>

  <el-dialog
    v-model="electronicDialogVisible"
    title="电子发票上传"
    width="600px"
  >
    <el-form label-width="120px">
      <el-form-item label="所属项目" required>
        <el-select
          v-model="electronicForm.project_id"
          filterable
          placeholder="请选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="填报人(可选)">
        <el-input
          v-model="electronicForm.applicant_userid"
          placeholder="如 zhiyuan.li"
        />
      </el-form-item>
      <el-form-item label="文件Key" required>
        <el-input
          v-model="electronicForm.file_key"
          placeholder="例如 reimbursement/e-invoice-001.jpg"
        />
      </el-form-item>
      <el-form-item label="文件名">
        <el-input
          v-model="electronicForm.file_name"
          placeholder="例如 发票001.jpg"
        />
      </el-form-item>
      <el-form-item label="发票号(可选)">
        <el-input v-model="electronicForm.invoice_no" />
      </el-form-item>
      <el-form-item label="金额(可选)">
        <el-input-number
          v-model="electronicForm.amount"
          :min="0"
          :precision="2"
          :step="100"
        />
      </el-form-item>
      <el-form-item label="开票日期(可选)">
        <el-date-picker
          v-model="electronicForm.issue_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="electronicForm.description"
          type="textarea"
          :rows="2"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="electronicDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="uploadingElectronic"
        @click="submitElectronicUpload"
      >
        上传并触发OCR
      </el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="quickScanDialogVisible" title="扫码/输入UUID打开信封" width="500px">
    <el-form label-width="90px">
      <el-form-item label="信封UUID" required>
        <el-input v-model="quickScanUuid" placeholder="请粘贴或扫码录入信封UUID" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="quickScanDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitQuickScan">打开信封</el-button>
    </template>
  </el-dialog>
</template>
