<script setup lang="ts">
import dayjs from "dayjs";
import type { UploadFile } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getCurrentUser } from "@/api/user";
import { listPendingApprovals, type PendingApprovalItem } from "@/api/approval";
import { listProjects, type Project } from "@/api/project";
import {
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import { getFuelQuotaPendingSummary } from "@/api/fleet";
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
const pendingApprovalItems = ref<PendingApprovalItem[]>([]);
const pendingApprovalTotal = ref(0);
const fuelOfficePendingCount = ref(0);
const projects = ref<Project[]>([]);

type PersonalCertificate = {
  id: number;
  name: string;
  issueDate: string;
  expireDate: string;
  fileUrl?: string;
  fileName?: string;
};

const certificates = ref<PersonalCertificate[]>([]);

const pendingApprovalCount = computed(() => pendingApprovalTotal.value);

const projectNameMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

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

const canLaunchOutboundPayment = computed(() =>
  roles.value.some(role =>
    ["super_admin", "manager", "site_manager", "finance", "operator"].includes(
      role
    )
  )
);

const canHandleFuelOffice = computed(() =>
  roles.value.some(role => ["super_admin", "manager", "finance"].includes(role))
);

const certStatus = (expireDate: string) => {
  const remainDays = dayjs(expireDate).diff(dayjs(), "day");
  if (remainDays < 0) return { type: "danger", text: "已过期" } as const;
  if (remainDays <= 30) return { type: "warning", text: "即将到期" } as const;
  return { type: "success", text: "有效" } as const;
};

const certificateWarningCount = computed(
  () =>
    certificates.value.filter(
      cert => certStatus(cert.expireDate).type !== "success"
    ).length
);

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

const reimbursementProgressStatusSet = new Set([
  "unregistered",
  "draft",
  "submitted",
  "received",
  "batched",
  "pending_approval"
]);

const reimbursementProgressItems = computed(() =>
  reimbursements.value.filter(item =>
    reimbursementProgressStatusSet.has(item.status)
  )
);

const activeReimbursementCount = computed(
  () => reimbursementProgressItems.value.length
);

const loadData = async () => {
  loading.value = true;
  try {
    const me = await getCurrentUser();
    username.value = me.data.username;
    fullName.value = me.data.nickname || me.data.username;
    roles.value = me.data.roles || [];
    permissions.value = me.data.permissions || [];
    const [reimbursementResult, pendingResult, projectResult] =
      await Promise.all([
        listReimbursementEnvelopes({
          creator_id: "me",
          page: 1,
          pageSize: 8
        }),
        listPendingApprovals({ page: 1, pageSize: 6 }),
        listProjects({ page: 1, pageSize: 300 })
      ]);
    reimbursements.value = reimbursementResult.data;
    pendingApprovalItems.value = pendingResult.data || [];
    pendingApprovalTotal.value = pendingResult.pagination?.total || 0;
    projects.value = projectResult.data || [];

    if (canHandleFuelOffice.value) {
      const fuelPendingResult = await getFuelQuotaPendingSummary();
      fuelOfficePendingCount.value = fuelPendingResult.data.pending_count;
    } else {
      fuelOfficePendingCount.value = 0;
    }
  } finally {
    loading.value = false;
  }
};

const todoSummaryLabel = (item: PendingApprovalItem) => {
  return `${item.instance_no} · ${item.biz_summary || item.biz_type}`;
};

const goApprovalDesk = () => {
  router.push("/approval/index");
};

const goPaymentWizard = () => {
  router.push("/workspace/payment/wizard");
};

const goCreateReimbursement = () => {
  router.push("/workspace/my-reimbursement/detail/create");
};

const goFuelApplication = () => {
  router.push("/workspace/fuel-application");
};

const goMyApplications = () => {
  router.push("/workspace/my-applications");
};

const goFuelOfficeDesk = () => {
  router.push("/finance/fleet/vehicles");
};

const goApprovalItem = (item: PendingApprovalItem) => {
  router.push(`/approval/detail/${item.id}`);
};

const reimbursementStatusLabel = (status: string) => {
  if (["submitted", "received", "batched", "pending_approval"].includes(status))
    return "审核中";
  if (["unregistered", "draft"].includes(status)) return "待处理";
  if (status === "paid") return "已打款";
  if (status === "approved") return "审核通过";
  if (status === "rejected") return "已驳回";
  if (status === "cancelled") return "已取消";
  return status;
};

const reimbursementApplyDate = (item: ReimbursementEnvelope) => {
  const source = item.expense_date || item.created_at || item.updated_at;
  return dayjs(source).isValid() ? dayjs(source).format("YYYY-MM-DD") : "-";
};

const reimbursementProjectLabel = (item: ReimbursementEnvelope) => {
  return projectNameMap.value[item.project_id] || `项目#${item.project_id}`;
};

const goReimbursementDetail = (id: number) => {
  router.push(`/workspace/my-reimbursement/detail/${id}`);
};

const formatAmount = (amount: number) => {
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
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
</script>

<template>
  <div v-loading="loading" class="workspace">
    <section class="workspace-hero">
      <div class="workspace-hero__main">
        <div class="workspace-hero__title">
          你好，{{ fullName || username || "同事" }}
        </div>
        <div class="workspace-hero__subtitle">
          集中处理报销、付款、审批与个人资质事项。
        </div>
        <div class="workspace-hero__identity">
          <el-tag size="small" type="info">账号：{{ username || "-" }}</el-tag>
          <el-tag
            v-for="role in roleLabels"
            :key="role"
            size="small"
            type="warning"
          >
            {{ role }}
          </el-tag>
          <el-tag
            v-for="perm in permissionLabels.slice(0, 4)"
            :key="perm"
            size="small"
            effect="plain"
          >
            {{ perm }}
          </el-tag>
          <el-tag v-if="permissionLabels.length > 4" size="small" effect="plain">
            +{{ permissionLabels.length - 4 }}
          </el-tag>
        </div>
      </div>

      <div class="workspace-stats">
        <button class="workspace-stat" type="button" @click="goApprovalDesk">
          <span>待我审批</span>
          <strong>{{ pendingApprovalCount }}</strong>
        </button>
        <button
          class="workspace-stat"
          type="button"
          @click="router.push('/workspace/my-reimbursement')"
        >
          <span>报销待处理</span>
          <strong>{{ activeReimbursementCount }}</strong>
        </button>
        <button
          v-if="canHandleFuelOffice"
          class="workspace-stat"
          type="button"
          @click="goFuelOfficeDesk"
        >
          <span>油卡待办</span>
          <strong>{{ fuelOfficePendingCount }}</strong>
        </button>
        <div class="workspace-stat">
          <span>证书预警</span>
          <strong>{{ certificateWarningCount }}</strong>
        </div>
      </div>
    </section>

    <section class="action-panel">
      <div>
        <div class="section-title">常用操作</div>
        <div class="section-subtitle">发起、查看和处理个人高频事项。</div>
      </div>
      <div class="action-grid">
        <el-button type="primary" @click="goCreateReimbursement">发起报销</el-button>
        <el-button @click="router.push('/workspace/my-reimbursement')">
          我的报销提交
        </el-button>
        <el-button :disabled="!canLaunchOutboundPayment" @click="goPaymentWizard">
          发起对外付款
        </el-button>
        <el-button @click="goFuelApplication">油卡额度申请</el-button>
        <el-button @click="goMyApplications">我的申请</el-button>
        <el-button @click="router.push('/project/hub')">进入项目大厅</el-button>
        <el-badge
          v-if="canHandleFuelOffice"
          :value="fuelOfficePendingCount"
          :hidden="fuelOfficePendingCount <= 0"
          :max="99"
        >
          <el-button @click="goFuelOfficeDesk">油卡办公室待办</el-button>
        </el-badge>
        <el-badge
          :value="pendingApprovalCount"
          :hidden="pendingApprovalCount <= 0"
          :max="99"
        >
          <el-button @click="goApprovalDesk">待我审批</el-button>
        </el-badge>
      </div>
    </section>

    <div class="workspace-content">
      <div class="workspace-content__main">
        <el-card shadow="never" class="workspace-card todo-card">
          <template #header>
            <div class="card-header card-header--with-action">
              <span>我的待办提醒（{{ pendingApprovalCount }}）</span>
              <el-space>
                <el-badge
                  v-if="canHandleFuelOffice"
                  :value="fuelOfficePendingCount"
                  :hidden="fuelOfficePendingCount <= 0"
                  :max="99"
                >
                  <el-button link type="primary" @click="goFuelOfficeDesk">
                    油卡办公室待办
                  </el-button>
                </el-badge>
                <el-button link type="primary" @click="goApprovalDesk">
                  进入统一审批台
                </el-button>
              </el-space>
            </div>
          </template>
          <el-empty
            v-if="!pendingApprovalItems.length"
            description="当前没有待办审批"
          />
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
                  当前节点：{{
                    item.current_node_name || item.current_node_key || "待处理"
                  }}
                </div>
                <el-tag size="small" type="warning">待审批</el-tag>
              </div>
              <div class="todo-item__time">{{ item.submitted_at }}</div>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" class="workspace-card timeline-card">
          <template #header>
            <div class="card-header">我的报销进度</div>
          </template>
          <el-empty
            v-if="!reimbursementProgressItems.length"
            description="暂无审核中或待处理报销"
          />
          <ul v-else class="reimbursement-progress-list">
            <li
              v-for="item in reimbursementProgressItems"
              :key="item.id"
              class="reimbursement-progress-list__item"
            >
              <span class="reimbursement-progress-list__dot" />
              <div class="reimbursement-progress-list__content">
                <div class="reimbursement-progress-list__main">
                  <el-link type="primary" @click="goReimbursementDetail(item.id)">
                    {{ reimbursementProjectLabel(item) }} · ¥{{
                      formatAmount(item.amount)
                    }}
                  </el-link>
                  <el-tag :type="reimbursementTagType(item.status)">
                    {{ reimbursementStatusLabel(item.status) }}
                  </el-tag>
                </div>
                <div class="reimbursement-progress-list__meta">
                  申报日期：{{ reimbursementApplyDate(item) }}
                </div>
              </div>
            </li>
          </ul>
        </el-card>
      </div>

      <aside class="workspace-content__side">
        <el-card shadow="never" class="workspace-card cert-card">
          <template #header>
            <div class="card-header card-header--with-action">
              <span>个人资质与证书</span>
              <el-tag size="small" type="info">{{ certificates.length }} 项</el-tag>
            </div>
          </template>

          <el-upload
            drag
            :auto-upload="false"
            :show-file-list="false"
            :on-change="onCertUpload"
          >
            <div class="cert-upload-text">拖拽证书文件到此处，或点击上传</div>
            <div class="cert-upload-hint">支持 PDF/图片，上传后可查看和下载</div>
          </el-upload>

          <div class="cert-grid">
            <el-card
              v-for="cert in certificates"
              :key="cert.id"
              shadow="never"
              class="cert-item"
            >
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
      </aside>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.workspace-hero,
.action-panel,
.workspace-card {
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.workspace-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
  gap: 20px;
  padding: 20px;
}

.workspace-hero__main {
  min-width: 0;
}

.workspace-hero__title {
  font-size: 22px;
  font-weight: 700;
  color: #1f2937;
}

.workspace-hero__subtitle {
  margin-top: 6px;
  color: #6b7280;
}

.workspace-hero__identity {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.workspace-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.workspace-stat {
  min-height: 82px;
  padding: 14px 16px;
  text-align: left;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

button.workspace-stat {
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

button.workspace-stat:hover {
  border-color: #409eff;
  box-shadow: 0 4px 14px rgb(64 158 255 / 12%);
}

.workspace-stat span {
  font-size: 13px;
  color: #6b7280;
}

.workspace-stat strong {
  display: block;
  margin-top: 8px;
  font-size: 24px;
  line-height: 1;
  color: #111827;
}

.action-panel {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  padding: 16px;
}

.section-title {
  font-weight: 700;
  color: #1f2937;
}

.section-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: #6b7280;
}

.action-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-grid :deep(.el-button + .el-button) {
  margin-left: 0;
}

.workspace-content {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 16px;
  align-items: start;
}

.workspace-content__main,
.workspace-content__side {
  display: grid;
  gap: 16px;
}

.card-header {
  font-weight: 700;
  color: #1f2937;
}

.card-header--with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cert-upload-text {
  font-weight: 600;
  color: #1f2937;
}

.cert-upload-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.cert-item__meta {
  margin-top: 6px;
  color: #6b7280;
}

.reimbursement-progress-list {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
  list-style: none;
}

.reimbursement-progress-list__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #ffffff;
}

.reimbursement-progress-list__dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: #e6a23c;
  flex-shrink: 0;
}

.reimbursement-progress-list__content {
  flex: 1;
  min-width: 0;
}

.reimbursement-progress-list__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.reimbursement-progress-list__meta {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
}

.cert-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 14px;
}

.cert-item {
  border-color: #ebeef5;
}

.cert-item__name {
  margin-bottom: 8px;
  font-weight: 700;
  color: #1f2937;
}

.cert-item__file {
  margin-top: 8px;
  font-size: 12px;
  color: #6b7280;
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
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.todo-item:hover {
  border-color: #409eff;
  box-shadow: 0 4px 14px rgb(64 158 255 / 10%);
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
  color: #1f2937;
}

.todo-item__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.todo-item__meta {
  font-size: 12px;
  color: #6b7280;
}

.todo-item__time {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
}

@media (max-width: 1080px) {
  .workspace-hero,
  .action-panel,
  .workspace-content {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .workspace-stats {
    grid-template-columns: 1fr;
  }

  .card-header--with-action {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
