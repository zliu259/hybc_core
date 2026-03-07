<script setup lang="ts">
import dayjs from "dayjs";
import type { UploadFile } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  getCurrentUser,
  listMyBankAccounts,
  createMyBankAccount,
  updateMyBankAccount,
  type MyBankAccount
} from "@/api/user";
import { listPendingApprovals, type PendingApprovalItem } from "@/api/approval";
import { listProjects, type Project } from "@/api/project";
import {
  createReimbursementEnvelope,
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import { message } from "@/utils/message";

defineOptions({
  name: "Welcome"
});

const router = useRouter();
const loading = ref(false);
const username = ref("");
const fullName = ref("");
const roles = ref<string[]>([]);
const permissions = ref<string[]>([]);
const reimbursements = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);
const reimbursementDialogVisible = ref(false);
const reimbursementSubmitting = ref(false);

const reimbursementForm = ref({
  project_id: undefined as number | undefined,
  amount: undefined as number | undefined,
  category: "办公费用",
  description: ""
});

const bankCards = ref<MyBankAccount[]>([]);
const bankEditVisible = ref(false);
const bankEditMode = ref<"create" | "edit">("create");
const bankSubmitting = ref(false);
const editingBankId = ref<number | null>(null);
const bankForm = ref({
  bank_name: "",
  account_name: "",
  account_no: ""
});
const pendingApprovalItems = ref<PendingApprovalItem[]>([]);
const pendingApprovalTotal = ref(0);

type PersonalCertificate = {
  id: number;
  name: string;
  issueDate: string;
  expireDate: string;
  fileUrl?: string;
  fileName?: string;
};

const certificates = ref<PersonalCertificate[]>([
  {
    id: 1,
    name: "特种设备操作证",
    issueDate: "2024-07-01",
    expireDate: "2026-07-01"
  },
  {
    id: 2,
    name: "安全培训证书",
    issueDate: "2023-09-10",
    expireDate: "2026-03-15"
  }
]);

const pendingCount = computed(
  () => reimbursements.value.filter(item => item.status !== "paid").length
);

const pendingApprovalCount = computed(() => pendingApprovalTotal.value);

const roleNameMap: Record<string, string> = {
  super_admin: "超级管理员",
  finance: "财务人员",
  manager: "项目经理",
  site_manager: "现场经理",
  operator: "操作员"
};

const roleLabels = computed(() =>
  roles.value.map(role => roleNameMap[role] || role)
);

const permissionLabels = computed(() => permissions.value.filter(Boolean));

const canWriteProjectLog = computed(() =>
  roles.value.some(role => ["super_admin", "manager", "site_manager"].includes(role))
);

const certStatus = (expireDate: string) => {
  const remainDays = dayjs(expireDate).diff(dayjs(), "day");
  if (remainDays < 0) return { type: "danger", text: "已过期" } as const;
  if (remainDays <= 30) return { type: "warning", text: "即将到期" } as const;
  return { type: "success", text: "有效" } as const;
};

const certHasFile = (cert: PersonalCertificate) => Boolean(cert.fileUrl);

const openCertFile = (cert: PersonalCertificate) => {
  if (!cert.fileUrl) {
    message("该证书暂无附件可查看", { type: "warning" });
    return;
  }
  window.open(cert.fileUrl, "_blank", "noopener,noreferrer");
};

const downloadCertFile = (cert: PersonalCertificate) => {
  if (!cert.fileUrl) {
    message("该证书暂无附件可下载", { type: "warning" });
    return;
  }
  const link = document.createElement("a");
  link.href = cert.fileUrl;
  link.download = cert.fileName || `${cert.name}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const reimbursementTagType = (status: string) => {
  if (status === "paid") return "success";
  if (status === "approved") return "primary";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "info";
  return "warning";
};

const loadData = async () => {
  loading.value = true;
  try {
    const me = await getCurrentUser();
    username.value = me.data.username;
    fullName.value = me.data.nickname || me.data.username;
    roles.value = me.data.roles || [];
    permissions.value = me.data.permissions || [];
    const [reimbursementResult, bankAccountResult, pendingResult] = await Promise.all([
      listReimbursementEnvelopes({
        creator_id: "me",
        page: 1,
        pageSize: 8
      }),
      listMyBankAccounts(),
      listPendingApprovals({ page: 1, pageSize: 6 })
    ]);
    reimbursements.value = reimbursementResult.data;
    bankCards.value = bankAccountResult.data;
    pendingApprovalItems.value = pendingResult.data || [];
    pendingApprovalTotal.value = pendingResult.pagination?.total || 0;
    const projectResult = await listProjects({ page: 1, pageSize: 200, status: "active" });
    projects.value = projectResult.data;
    if (!reimbursementForm.value.project_id && projects.value.length > 0) {
      reimbursementForm.value.project_id = projects.value[0].id;
    }
    if (!bankCards.value.length) {
      bankCards.value = [
        {
          id: 0,
          bank_name: "待补充",
          account_name: "--",
          account_no: "请在个人设置中绑定银行卡"
        }
      ];
    }
  } finally {
    loading.value = false;
  }
};

const openCreateBankCard = () => {
  bankEditMode.value = "create";
  editingBankId.value = null;
  bankForm.value = {
    bank_name: "",
    account_name: fullName.value || username.value || "",
    account_no: ""
  };
  bankEditVisible.value = true;
};

const openEditBankCard = (card: MyBankAccount) => {
  bankEditMode.value = "edit";
  editingBankId.value = card.id;
  bankForm.value = {
    bank_name: card.bank_name,
    account_name: card.account_name,
    account_no: card.account_no
  };
  bankEditVisible.value = true;
};

const submitBankCard = async () => {
  const payload = {
    bank_name: bankForm.value.bank_name.trim(),
    account_name: bankForm.value.account_name.trim(),
    account_no: bankForm.value.account_no.trim()
  };
  if (!payload.bank_name || !payload.account_name || !payload.account_no) {
    message("请完整填写收款卡信息", { type: "warning" });
    return;
  }

  bankSubmitting.value = true;
  try {
    if (bankEditMode.value === "create") {
      await createMyBankAccount(payload);
      message("已新增收款卡", { type: "success" });
    } else if (editingBankId.value) {
      await updateMyBankAccount(editingBankId.value, payload);
      message("已更新收款卡", { type: "success" });
    }
    bankEditVisible.value = false;
    await loadData();
  } finally {
    bankSubmitting.value = false;
  }
};

const todoSummaryLabel = (item: PendingApprovalItem) => {
  return `${item.instance_no} · ${item.biz_summary || item.biz_type}`;
};

const goApprovalDesk = () => {
  router.push("/approval/index");
};

const goApprovalItem = (item: PendingApprovalItem) => {
  router.push(`/approval/detail/${item.id}`);
};

const reimbursementStatusLabel = (status: string) => {
  if (status === "paid") return "已打款";
  if (status === "approved") return "审核通过";
  if (status === "rejected") return "已驳回";
  if (status === "cancelled") return "已取消";
  if (status === "submitted") return "审核中";
  return "待处理";
};

const formatAmount = (amount: number) => {
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const maskCardNo = (cardNo: string) => {
  if (cardNo.length <= 8) return cardNo;
  return `${cardNo.slice(0, 4)} **** **** ${cardNo.slice(-4)}`;
};

onMounted(async () => {
  await loadData();
});

const onCertUpload = (file: UploadFile) => {
  const raw = file.raw;
  const objectUrl = raw ? URL.createObjectURL(raw) : file.url;
  certificates.value.push({
    id: Date.now(),
    name: file.name,
    issueDate: dayjs().format("YYYY-MM-DD"),
    expireDate: dayjs().add(365, "day").format("YYYY-MM-DD"),
    fileUrl: objectUrl,
    fileName: file.name
  });
};

const openReimbursementDialog = () => {
  reimbursementForm.value = {
    project_id: projects.value[0]?.id,
    amount: undefined,
    category: "办公费用",
    description: ""
  };
  reimbursementDialogVisible.value = true;
};

const submitReimbursement = async () => {
  if (!reimbursementForm.value.project_id) {
    message("请选择项目", { type: "warning" });
    return;
  }
  reimbursementSubmitting.value = true;
  try {
    const result = await createReimbursementEnvelope({
      project_id: reimbursementForm.value.project_id,
      amount: reimbursementForm.value.amount,
      category: reimbursementForm.value.category,
      description: reimbursementForm.value.description || undefined,
      channel: "physical"
    });
    message(`已创建报销信封 ${result.data.envelope_no}`, { type: "success" });
    reimbursementDialogVisible.value = false;
    await loadData();
    router.push(`/workspace/my-reimbursement/detail/${result.data.id}`);
  } finally {
    reimbursementSubmitting.value = false;
  }
};

</script>

<template>
  <div class="workspace" v-loading="loading">
    <el-card shadow="never" class="welcome-card">
      <div class="welcome-card__title">你好，{{ fullName || username || "同事" }}</div>
      <div class="welcome-card__identity">
        <el-tag size="small" type="info">账号：{{ username || "-" }}</el-tag>
        <el-tag
          v-for="role in roleLabels"
          :key="role"
          size="small"
          type="warning"
        >
          {{ role }}
        </el-tag>
      </div>
      <div class="welcome-card__permissions">
        <el-tag size="small" type="primary">权限</el-tag>
        <el-tag
          v-for="perm in permissionLabels"
          :key="perm"
          size="small"
          effect="plain"
          >{{ perm }}</el-tag
        >
        <el-tag v-if="permissionLabels.length === 0" size="small" effect="plain"
          >无显式权限标识</el-tag
        >
      </div>
      <div class="welcome-card__sub">今天待处理事项 {{ pendingCount }} 条</div>
      <div class="welcome-card__actions">
        <el-button type="primary" @click="openReimbursementDialog"
          >发起报销</el-button
        >
        <el-button @click="router.push('/workspace/my-reimbursement')">我的提交</el-button>
        <el-button @click="router.push('/construction/operator-log/form')"
          >填报施工日志</el-button
        >
        <el-button
          :disabled="!canWriteProjectLog"
          @click="router.push('/construction/manager-log')"
          >填报项目日志</el-button
        >
        <el-badge :value="pendingApprovalCount" :hidden="pendingApprovalCount <= 0" :max="99">
          <el-button @click="goApprovalDesk">待我审批</el-button>
        </el-badge>
      </div>
    </el-card>

    <el-dialog
      v-model="reimbursementDialogVisible"
      title="发起报销"
      width="520px"
      destroy-on-close
    >
      <el-form label-width="100px">
        <el-form-item label="所属项目" required>
          <el-select
            v-model="reimbursementForm.project_id"
            filterable
            placeholder="请选择项目"
            style="width: 100%"
          >
            <el-option
              v-for="project in projects"
              :key="project.id"
              :label="`${project.project_name} (${project.project_code})`"
              :value="project.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="报销金额">
          <el-input-number
            v-model="reimbursementForm.amount"
            :min="0"
            :precision="2"
            :step="100"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="类别">
          <el-input v-model="reimbursementForm.category" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="reimbursementForm.description"
            type="textarea"
            :rows="3"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reimbursementDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="reimbursementSubmitting"
          @click="submitReimbursement"
          >创建信封</el-button
        >
      </template>
    </el-dialog>

    <div class="workspace__row">
      <el-card shadow="never" class="bank-card-block">
        <template #header>
          <div class="card-header card-header--with-action">
            <span>我的收款卡</span>
            <el-button link type="primary" @click="openCreateBankCard">新增</el-button>
          </div>
        </template>
        <div v-for="card in bankCards" :key="card.id" class="bank-card">
          <div class="bank-card__bank">{{ card.bank_name }}</div>
          <div class="bank-card__no">{{ maskCardNo(card.account_no) }}</div>
          <div class="bank-card__holder">持卡人：{{ card.account_name }}</div>
          <div class="bank-card__actions">
            <el-button link type="primary" @click="openEditBankCard(card)">编辑</el-button>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="timeline-card">
        <template #header>
          <div class="card-header">我的报销进度</div>
        </template>
        <el-empty v-if="!reimbursements.length" description="暂无报销记录" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="item in reimbursements"
            :key="item.id"
            :timestamp="item.updated_at"
          >
            <div class="timeline-item">
              <span>{{ item.envelope_no }} · ¥{{ formatAmount(item.amount) }}</span>
              <el-tag :type="reimbursementTagType(item.status)">
                {{ reimbursementStatusLabel(item.status) }}
              </el-tag>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </div>

    <el-card shadow="never" class="cert-card">
      <template #header>
        <div class="card-header">个人资质与证书</div>
      </template>

      <el-upload drag :auto-upload="false" :show-file-list="false" :on-change="onCertUpload">
        <div>拖拽证书文件到此处，或点击上传（PDF/图片）</div>
      </el-upload>

      <div class="cert-grid">
        <el-card v-for="cert in certificates" :key="cert.id" shadow="never" class="cert-item">
          <div class="cert-item__name">{{ cert.name }}</div>
          <div class="cert-item__meta">颁发：{{ cert.issueDate }}</div>
          <div class="cert-item__meta">有效期：{{ cert.expireDate }}</div>
          <el-tag :type="certStatus(cert.expireDate).type">
            {{ certStatus(cert.expireDate).text }}
          </el-tag>
          <div class="cert-item__file">{{ cert.fileName || "未上传附件" }}</div>
          <div class="cert-item__actions">
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!certHasFile(cert)"
              @click="openCertFile(cert)"
            >
              查看
            </el-button>
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!certHasFile(cert)"
              @click="downloadCertFile(cert)"
            >
              下载
            </el-button>
          </div>
        </el-card>
      </div>
    </el-card>

    <el-card shadow="never" class="todo-card">
      <template #header>
        <div class="card-header card-header--with-action">
          <span>我的待办提醒（{{ pendingApprovalCount }}）</span>
          <el-button link type="primary" @click="goApprovalDesk">进入统一审批台</el-button>
        </div>
      </template>
      <el-empty v-if="!pendingApprovalItems.length" description="当前没有待办审批" />
      <div v-else class="todo-cards">
        <div
          v-for="item in pendingApprovalItems"
          :key="item.task_id"
          class="todo-item"
          @click="goApprovalItem(item)"
        >
          <div class="todo-item__title-row">
            <span class="todo-item__dot" />
            <div class="todo-item__title">{{ todoSummaryLabel(item) }}</div>
          </div>
          <div class="todo-item__meta-row">
            <div class="todo-item__meta">
              当前节点：{{ item.current_node_name || item.current_node_key || "待处理" }}
            </div>
            <el-tag size="small" type="warning">待审批</el-tag>
          </div>
          <div class="todo-item__time">{{ item.submitted_at }}</div>
        </div>
      </div>
    </el-card>

    <el-dialog
      v-model="bankEditVisible"
      :title="bankEditMode === 'create' ? '新增收款卡' : '编辑收款卡'"
      width="460px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="开户行" required>
          <el-input v-model="bankForm.bank_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="户名" required>
          <el-input v-model="bankForm.account_name" maxlength="64" />
        </el-form-item>
        <el-form-item label="账号" required>
          <el-input v-model="bankForm.account_no" maxlength="64" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bankEditVisible = false">取消</el-button>
        <el-button type="primary" :loading="bankSubmitting" @click="submitBankCard">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.welcome-card {
  border-color: #d9ceb9;
  background: #fffaf2;
}

.welcome-card__title {
  font-size: 22px;
  font-weight: 700;
  color: #2a241d;
}

.welcome-card__sub {
  margin-top: 6px;
  color: #6e6458;
}

.welcome-card__identity {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.welcome-card__permissions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.welcome-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.workspace__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.card-header {
  font-weight: 700;
  color: #2a241d;
}

.card-header--with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bank-card-block,
.timeline-card,
.cert-card,
.todo-card {
  border-color: #d9ceb9;
}

.bank-card {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}

.bank-card__bank {
  font-weight: 700;
  color: #2a241d;
}

.bank-card__no,
.bank-card__holder,
.cert-item__meta {
  margin-top: 6px;
  color: #6e6458;
}

.bank-card__actions {
  margin-top: 6px;
}

.timeline-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.cert-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.cert-item {
  border-color: #d9ceb9;
}

.cert-item__name {
  margin-bottom: 8px;
  font-weight: 700;
  color: #2a241d;
}

.cert-item__file {
  margin-top: 8px;
  font-size: 12px;
  color: #8b7f72;
}

.cert-item__actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.todo-cards {
  display: grid;
  gap: 10px;
}

.todo-item {
  border: 1px solid #e4d8c8;
  border-radius: 10px;
  background: #fff;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.todo-item:hover {
  border-color: #c8b49a;
  box-shadow: 0 2px 10px rgb(0 0 0 / 6%);
}

.todo-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.todo-item__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e6a23c;
  flex-shrink: 0;
}

.todo-item__title {
  font-weight: 600;
  color: #2a241d;
}

.todo-item__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.todo-item__meta {
  color: #6e6458;
  font-size: 12px;
}

.todo-item__time {
  margin-top: 6px;
  color: #9b8f82;
  font-size: 12px;
}

@media (max-width: 980px) {
  .workspace__row,
  .cert-grid {
    grid-template-columns: 1fr;
  }
}
</style>
