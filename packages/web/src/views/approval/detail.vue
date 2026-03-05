<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  getApprovalDetail,
  approveApproval,
  rejectApproval,
  returnApproval,
  transferApproval,
  withdrawApproval,
  cancelApproval,
  resubmitApproval,
  type ApprovalDetailResponse,
  type ApprovalTask
} from "@/api/approval";
import {
  getRiskReport,
  getPaymentRequest,
  type PaymentRequestDetail
} from "@/api/payment";
import {
  getBatchAuditReport,
  getReimbursementBatch,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";
import { getContract, type ContractDetail } from "@/api/contract";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { resolveUploadUrl } from "@/api/upload";
import { formatBeijingDateTime } from "@/utils/datetime";
import { toActionLabel, toBizTypeLabel, toStatusLabel } from "./labels";

defineOptions({ name: "ApprovalDetail" });

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const detail = ref<ApprovalDetailResponse | null>(null);
const selectedRound = ref(1);

const instanceId = computed(() => Number(route.params.id));

const availableRounds = computed(() => {
  if (!detail.value) return [1];
  const maxRound = detail.value.instance.current_round;
  return Array.from({ length: maxRound }, (_, i) => i + 1);
});

const roundNodes = computed(() => {
  if (!detail.value) return [];
  return detail.value.nodes
    .filter(n => n.round === selectedRound.value)
    .sort((a, b) => a.sort_order - b.sort_order);
});

const aiGateReviews = computed(() => detail.value?.ai_gate_reviews ?? []);

const getNodeTasks = (nodeId: number): ApprovalTask[] => {
  if (!detail.value) return [];
  return detail.value.tasks.filter(t => t.node_instance_id === nodeId);
};

const getNodeAssignees = (assigneeUserids: string | null): string[] => {
  if (!assigneeUserids) return [];
  try {
    const parsed = JSON.parse(assigneeUserids) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
};

const nodeStatusColor: Record<string, string> = {
  completed: "#67c23a",
  in_progress: "#409eff",
  pending: "#909399",
  skipped: "#909399",
  returned: "#e6a23c"
};

const nodeTypeLabelMap: Record<string, string> = {
  sequential: "顺序签",
  countersign: "会签",
  or_sign: "或签",
  auto: "自动",
  cc: "抄送",
  ai_gate: "AI关卡"
};

const hasAction = (action: string) =>
  detail.value?.available_actions.includes(action) ?? false;

const commentInput = ref("");
const actionLoading = ref(false);

const returnDialogVisible = ref(false);
const returnType = ref<"initiator" | "prev" | "to">("initiator");
const returnTargetNodeKey = ref("");
const returnComment = ref("");

const transferDialogVisible = ref(false);
const transferToUserid = ref("");
const transferReason = ref("");
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const { projects, loadProjects } = useProjectOptions();
const entities = ref<Entity[]>([]);

type TagType = "primary" | "success" | "warning" | "danger" | "info";
const paymentRiskStatus = ref("none");
const paymentRiskReport = ref<Record<string, unknown> | null>(null);
const reimbursementAuditStatus = ref("none");
const reimbursementAuditReport = ref<Record<string, unknown> | string | null>(
  null
);
const paymentDetail = ref<PaymentRequestDetail | null>(null);
const contractDetail = ref<ContractDetail | null>(null);
const reimbursementBatchDetail = ref<ReimbursementBatchDetail | null>(null);
const riskTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const aiGateTagType: Record<string, TagType> = {
  pending: "warning",
  assigned: "warning",
  running: "warning",
  completed: "success",
  failed: "danger",
  timeout: "danger"
};

type AiReviewRow = {
  node_key: string;
  outcome: string | null;
  comment: string | null;
  summary: string | null;
  completed_at: string | null;
  created_at: string;
};

type AiReviewNormalized = {
  outcomeCode: string | null;
  outcomeLabel: string;
  outcomeTagType: TagType;
  summaryText: string;
};

const parseEmbeddedAiSummary = (text: string | null | undefined) => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      outcome?: unknown;
      comment?: unknown;
      summary?: unknown;
    };
    return {
      outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
      comment: typeof parsed.comment === "string" ? parsed.comment : null,
      summary: typeof parsed.summary === "string" ? parsed.summary : null
    };
  } catch {
    return null;
  }
};

const parseAiDecisionFromText = (text: string | null | undefined) => {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      outcome?: unknown;
      comment?: unknown;
    };
    return {
      outcome: typeof parsed.outcome === "string" ? parsed.outcome : null,
      comment: typeof parsed.comment === "string" ? parsed.comment : null
    };
  } catch {
    return null;
  }
};

const toAiOutcomeLabel = (outcome: string | null | undefined, comment: string | null | undefined) => {
  if (outcome === "approve") return "建议通过";
  if (outcome === "reject") {
    const text = comment ?? "";
    return /补充|资料|证据|材料/.test(text) ? "建议补充材料" : "建议拒绝";
  }
  return "-";
};

const toAiOutcomeTagType = (
  outcome: string | null | undefined,
  comment: string | null | undefined
): TagType => {
  if (outcome === "approve") return "success";
  if (outcome === "reject") {
    const text = comment ?? "";
    return /补充|资料|证据|材料/.test(text) ? "warning" : "danger";
  }
  return "info";
};

const normalizeAiReview = (row: AiReviewRow): AiReviewNormalized => {
  const embedded = parseEmbeddedAiSummary(row.summary);
  const outcome = row.outcome ?? embedded?.outcome ?? null;
  const comment = row.comment ?? embedded?.comment ?? embedded?.summary ?? null;
  const summaryText =
    comment ??
    (row.summary && !parseEmbeddedAiSummary(row.summary) ? row.summary : null) ??
    "-";
  return {
    outcomeCode: outcome,
    outcomeLabel: toAiOutcomeLabel(outcome, comment),
    outcomeTagType: toAiOutcomeTagType(outcome, comment),
    summaryText
  };
};

const aiReviewByNodeKey = computed(() => {
  const map = new Map<string, AiReviewNormalized>();
  for (const row of aiGateReviews.value as AiReviewRow[]) {
    if (!row.node_key) continue;
    map.set(row.node_key, normalizeAiReview(row));
  }
  return map;
});

const getAiNodeSuggestion = (nodeKey: string): AiReviewNormalized | null => {
  return aiReviewByNodeKey.value.get(nodeKey) ?? null;
};

const formatAiNodeDecision = (task: ApprovalTask) => {
  if (task.assignee_userid !== "AI_GATE") {
    return toActionLabel(task.action);
  }
  const embedded = parseAiDecisionFromText(task.comment);
  const outcome = embedded?.outcome ?? task.action;
  const comment = embedded?.comment ?? task.comment;
  if (outcome || comment) {
    return toAiOutcomeLabel(outcome, comment);
  }
  const node = detail.value?.nodes.find(item => item.id === task.node_instance_id);
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.outcomeLabel ?? "-";
};

const formatAiNodeDecisionTagType = (task: ApprovalTask): TagType => {
  if (task.assignee_userid !== "AI_GATE") return "info";
  const embedded = parseAiDecisionFromText(task.comment);
  const outcome = embedded?.outcome ?? task.action;
  const comment = embedded?.comment ?? task.comment;
  if (outcome || comment) {
    return toAiOutcomeTagType(outcome, comment);
  }
  const node = detail.value?.nodes.find(item => item.id === task.node_instance_id);
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.outcomeTagType ?? "info";
};

const formatAiNodeComment = (task: ApprovalTask) => {
  if (task.assignee_userid !== "AI_GATE") return task.comment;
  const embedded = parseAiDecisionFromText(task.comment);
  if (embedded?.comment) return embedded.comment;
  if (task.comment) return task.comment;
  const node = detail.value?.nodes.find(item => item.id === task.node_instance_id);
  const fallback = node ? getAiNodeSuggestion(node.node_key) : null;
  return fallback?.summaryText === "-" ? "" : fallback?.summaryText;
};

type AttachmentItem = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

const parseAttachments = (raw: string | null | undefined): AttachmentItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const list: Array<AttachmentItem | null> = parsed.map(item => {
      if (typeof item === "string") {
        return { file_key: item, file_name: item };
      }
      if (item && typeof item === "object") {
        const row = item as {
          file_key?: string;
          key?: string;
          file_name?: string;
          name?: string;
          file_size?: number;
          size?: number;
        };
        const key = row.file_key ?? row.key;
        if (!key) return null;
        return {
          file_key: key,
          file_name: row.file_name ?? row.name ?? key,
          file_size: row.file_size ?? row.size
        };
      }
      return null;
    });
    return list.filter((item): item is AttachmentItem => item !== null);
  } catch {
    return [];
  }
};

const paymentAttachments = computed(() =>
  parseAttachments(paymentDetail.value?.attachments_json)
);
const contractAttachments = computed(() =>
  parseAttachments(contractDetail.value?.attachments_json)
);
const fileUrl = (fileKey: string) =>
  resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);

const projectNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of projects.value) {
    map.set(item.id, item.project_name);
  }
  return map;
});

const entityNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of entities.value) {
    map.set(item.id, item.entity_name);
  }
  return map;
});

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const item of wecomUsers.value) {
    map.set(item.userid, item.name || item.userid);
  }
  return map;
});

const toProjectLabel = (projectId: number | null | undefined) => {
  if (typeof projectId !== "number") return "-";
  return projectNameMap.value.get(projectId) ?? String(projectId);
};

const toEntityLabel = (entityId: number | null | undefined) => {
  if (typeof entityId !== "number") return "-";
  return entityNameMap.value.get(entityId) ?? String(entityId);
};

const toUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const toChineseAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";
  if (amount === 0) return "零元整";

  const fractionUnits = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const intUnits = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];

  let value = Math.round(amount * 100);
  const fraction = value % 100;
  let result = "";

  if (fraction === 0) {
    result = "整";
  } else {
    const jiao = Math.floor(fraction / 10);
    const fen = fraction % 10;
    if (jiao > 0) result += `${digit[jiao]}${fractionUnits[0]}`;
    if (fen > 0) result += `${digit[fen]}${fractionUnits[1]}`;
  }

  value = Math.floor(value / 100);
  let sectionIndex = 0;
  let intResult = "";

  while (value > 0 && sectionIndex < sectionUnits.length) {
    const sectionValue = value % 10000;
    if (sectionValue !== 0) {
      let sectionText = "";
      let unitIndex = 0;
      let section = sectionValue;
      let zeroPending = false;
      while (section > 0) {
        const num = section % 10;
        if (num === 0) {
          if (!zeroPending && sectionText) {
            zeroPending = true;
            sectionText = `零${sectionText}`;
          }
        } else {
          zeroPending = false;
          sectionText = `${digit[num]}${intUnits[unitIndex]}${sectionText}`;
        }
        unitIndex += 1;
        section = Math.floor(section / 10);
      }
      sectionText = sectionText.replace(/零+/g, "零").replace(/零$/g, "");
      intResult = `${sectionText}${sectionUnits[sectionIndex]}${intResult}`;
    } else if (intResult && !intResult.startsWith("零")) {
      intResult = `零${intResult}`;
    }
    sectionIndex += 1;
    value = Math.floor(value / 10000);
  }

  intResult = intResult.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
  intResult = intResult.replace(/亿万/g, "亿").replace(/零$/g, "");
  return `${intResult || "零"}元${result}`;
};

const formatAmount = (amount: number | null | undefined) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const formatAmountWithUpper = (amount: number | null | undefined, upper?: string | null) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { lower: "-", upper: "-" };
  }
  const upperText = typeof upper === "string" && upper.trim() ? upper.trim() : toChineseAmount(amount);
  return {
    lower: formatAmount(amount),
    upper: upperText
  };
};

const paymentAmountDisplay = computed(() =>
  formatAmountWithUpper(paymentDetail.value?.amount, paymentDetail.value?.amount_cn)
);

const contractAmountDisplay = computed(() =>
  formatAmountWithUpper(contractDetail.value?.total_amount)
);

const reimbursementAmountDisplay = computed(() =>
  formatAmountWithUpper(reimbursementBatchDetail.value?.total_amount)
);

const loadMetaOptions = async () => {
  const [, entityRes] = await Promise.all([loadProjects(), listEntities()]);
  entities.value = entityRes.data;
};

const previewDrawerVisible = ref(false);
const previewFileUrl = ref("");
const previewFileName = ref("");
const previewInline = computed(() => {
  const lower = previewFileName.value.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".txt")
  );
});

const openAttachmentPreview = (fileKey: string, fileName: string) => {
  previewFileUrl.value = fileUrl(fileKey);
  previewFileName.value = fileName;
  previewDrawerVisible.value = true;
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const result = await getApprovalDetail(instanceId.value);
    detail.value = result.data;
    selectedRound.value = result.data.instance.current_round;
    paymentDetail.value = null;
    contractDetail.value = null;
    reimbursementBatchDetail.value = null;

    const bizType = result.data.instance.biz_type;
    const bizId = result.data.instance.biz_id;

    if (bizType === "payment_request") {
      const paymentRes = await getPaymentRequest(bizId);
      paymentDetail.value = paymentRes.data;
    } else if (bizType === "outbound_contract" || bizType === "inbound_contract") {
      const contractRes = await getContract(bizId);
      contractDetail.value = contractRes.data;
    } else if (bizType === "reimbursement_batch") {
      const reimbursementRes = await getReimbursementBatch(bizId);
      reimbursementBatchDetail.value = reimbursementRes.data;
    }

    if (bizType === "payment_request") {
      const rr = await getRiskReport(bizId);
      paymentRiskStatus.value = rr.data.status;
      paymentRiskReport.value = rr.data.result;
      reimbursementAuditStatus.value = "none";
      reimbursementAuditReport.value = null;
    } else if (bizType === "reimbursement_batch") {
      const rr = await getBatchAuditReport(bizId);
      reimbursementAuditStatus.value = rr.data.status;
      reimbursementAuditReport.value = rr.data.result;
      paymentRiskStatus.value = "none";
      paymentRiskReport.value = null;
    } else {
      paymentRiskStatus.value = "none";
      paymentRiskReport.value = null;
      reimbursementAuditStatus.value = "none";
      reimbursementAuditReport.value = null;
    }
  } catch {
    message("加载审批详情失败", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const handleApprove = async () => {
  if (!commentInput.value.trim()) {
    message("请输入审批意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await approveApproval(instanceId.value, { comment: commentInput.value });
    message("审批通过", { type: "success" });
    commentInput.value = "";
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleReject = async () => {
  if (!commentInput.value.trim()) {
    message("请输入审批意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await rejectApproval(instanceId.value, { comment: commentInput.value });
    message("已驳回", { type: "success" });
    commentInput.value = "";
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const openReturnDialog = () => {
  returnType.value = "initiator";
  returnTargetNodeKey.value = "";
  returnComment.value = "";
  returnDialogVisible.value = true;
};

const handleReturn = async () => {
  actionLoading.value = true;
  try {
    await returnApproval(instanceId.value, {
      type: returnType.value,
      target_node_key:
        returnType.value === "to" ? returnTargetNodeKey.value : undefined,
      comment: returnComment.value || undefined
    });
    message("已退回", { type: "success" });
    returnDialogVisible.value = false;
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const openTransferDialog = () => {
  transferToUserid.value = "";
  transferReason.value = "";
  transferDialogVisible.value = true;
};

const handleTransfer = async () => {
  if (!transferToUserid.value.trim() || !transferReason.value.trim()) {
    message("请填写转办人和原因", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await transferApproval(instanceId.value, {
      to_userid: transferToUserid.value,
      reason: transferReason.value
    });
    message("已转办", { type: "success" });
    transferDialogVisible.value = false;
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleWithdraw = async () => {
  actionLoading.value = true;
  try {
    await withdrawApproval(instanceId.value);
    message("已撤回", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleCancel = async () => {
  actionLoading.value = true;
  try {
    await cancelApproval(instanceId.value);
    message("已取消", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const handleResubmit = async () => {
  actionLoading.value = true;
  try {
    await resubmitApproval(instanceId.value);
    message("已重新提交", { type: "success" });
    await loadDetail();
  } catch {
    message("操作失败", { type: "error" });
  } finally {
    actionLoading.value = false;
  }
};

const goBack = () => router.push("/approval/index");

onMounted(async () => {
  await Promise.all([loadDetail(), loadWecomUsers(), loadMetaOptions()]);
});
</script>

<template>
  <div v-loading="loading">
    <el-page-header style="margin-bottom: 16px" @back="goBack">
      <template #content>
        <span v-if="detail"
          >{{ detail.instance.instance_no }} —
          {{ detail.instance.biz_summary }}</span
        >
      </template>
    </el-page-header>

    <template v-if="detail">
      <el-row :gutter="16">
        <el-col :md="14" :xs="24">
          <el-card shadow="never" header="业务摘要">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="审批编号">{{
                detail.instance.instance_no
              }}</el-descriptions-item>
              <el-descriptions-item label="业务类型">{{
                toBizTypeLabel(detail.instance.biz_type)
              }}</el-descriptions-item>
              <el-descriptions-item label="发起人">{{
                detail.instance.initiator_userid
              }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag size="small">{{ toStatusLabel(detail.instance.status) }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="提交时间">{{
                formatBeijingDateTime(detail.instance.submitted_at)
              }}</el-descriptions-item>
              <el-descriptions-item label="完成时间">{{
                detail.instance.completed_at
                  ? formatBeijingDateTime(detail.instance.completed_at)
                  : "—"
              }}</el-descriptions-item>
              <el-descriptions-item label="摘要" :span="2">{{
                detail.instance.biz_summary
              }}</el-descriptions-item>
            </el-descriptions>

            <template v-if="detail.instance.biz_type === 'payment_request'">
              <el-divider>付款风险评估</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[paymentRiskStatus] || 'info'">
                  {{ toStatusLabel(paymentRiskStatus) }}
                </el-tag>
              </div>
              <el-descriptions v-if="paymentRiskReport" :column="2" border>
                <el-descriptions-item label="风险等级">
                  {{ paymentRiskReport.overall_risk || "-" }}
                </el-descriptions-item>
                <el-descriptions-item label="风险分数">
                  {{ paymentRiskReport.score ?? "-" }}
                </el-descriptions-item>
                <el-descriptions-item label="总结" :span="2">
                  {{ paymentRiskReport.summary || "-" }}
                </el-descriptions-item>
                <el-descriptions-item label="建议" :span="2">
                  {{
                    Array.isArray(paymentRiskReport.recommendations)
                      ? paymentRiskReport.recommendations.join("；")
                      : "-"
                  }}
                </el-descriptions-item>
              </el-descriptions>
            </template>

            <template v-if="paymentDetail">
              <el-divider>申请明细（付款）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="流水号">{{ paymentDetail.serial_no }}</el-descriptions-item>
                <el-descriptions-item label="关联合同">
                  {{
                    paymentDetail.contract
                      ? `${paymentDetail.contract.contract_no} - ${paymentDetail.contract.counterparty}`
                      : "无合同 / 无需合同"
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="所属项目">{{ toProjectLabel(paymentDetail.project_id) }}</el-descriptions-item>
                <el-descriptions-item label="收款方">{{ paymentDetail.payee?.name || '-' }}</el-descriptions-item>
                <el-descriptions-item label="收款账号" :span="2">
                  {{
                    paymentDetail.payee
                      ? `${paymentDetail.payee.bank_name} / ${paymentDetail.payee.bank_account}`
                      : '-'
                  }}
                </el-descriptions-item>
                <el-descriptions-item label="申请金额">
                  {{ paymentAmountDisplay.lower }}（<strong>{{ paymentAmountDisplay.upper }}</strong>）
                </el-descriptions-item>
                <el-descriptions-item label="付款类别">{{ paymentDetail.category }}</el-descriptions-item>
                <el-descriptions-item label="预计付款日">{{ paymentDetail.expected_payment_date }}</el-descriptions-item>
                <el-descriptions-item label="付款方式">{{ paymentDetail.payment_method }}</el-descriptions-item>
                <el-descriptions-item label="付款内容" :span="2">{{ paymentDetail.content }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ paymentDetail.remark || '-' }}</el-descriptions-item>
              </el-descriptions>
              <el-table :data="paymentAttachments" size="small" border style="margin-top: 12px">
                <el-table-column label="附件名" min-width="240">
                  <template #default="scope">{{ scope.row.file_name }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{ scope.row.file_size ?? '-' }}</template>
                </el-table-column>
                <el-table-column label="操作" width="190">
                  <template #default="scope">
                    <el-link
                      type="primary"
                      @click="openAttachmentPreview(scope.row.file_key, scope.row.file_name)"
                    >
                      预览
                    </el-link>
                    <el-link :href="fileUrl(scope.row.file_key)" target="_blank" type="primary">
                      下载
                    </el-link>
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="contractDetail">
              <el-divider>申请明细（合同）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="合同号">{{ contractDetail.contract_no }}</el-descriptions-item>
                <el-descriptions-item label="方向">{{ contractDetail.direction }}</el-descriptions-item>
                <el-descriptions-item label="所属项目">{{ toProjectLabel(contractDetail.project_id) }}</el-descriptions-item>
                <el-descriptions-item label="我方主体">{{ toEntityLabel(contractDetail.entity_id) }}</el-descriptions-item>
                <el-descriptions-item label="对方单位">{{ contractDetail.counterparty }}</el-descriptions-item>
                <el-descriptions-item label="合同类型">{{ contractDetail.contract_type }}</el-descriptions-item>
                <el-descriptions-item label="经办人">{{ toUserLabel(contractDetail.handler_userid) }}</el-descriptions-item>
                <el-descriptions-item label="合同日期">{{ contractDetail.contract_date }}</el-descriptions-item>
                <el-descriptions-item label="合同金额">
                  {{ contractAmountDisplay.lower }}（<strong>{{ contractAmountDisplay.upper }}</strong>）
                </el-descriptions-item>
                <el-descriptions-item label="已付金额">{{ contractDetail.paid_amount }}</el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ contractDetail.remark || '-' }}</el-descriptions-item>
              </el-descriptions>
              <el-table :data="contractAttachments" size="small" border style="margin-top: 12px">
                <el-table-column label="附件名" min-width="240">
                  <template #default="scope">{{ scope.row.file_name }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{ scope.row.file_size ?? '-' }}</template>
                </el-table-column>
                <el-table-column label="操作" width="190">
                  <template #default="scope">
                    <el-link
                      type="primary"
                      @click="openAttachmentPreview(scope.row.file_key, scope.row.file_name)"
                    >
                      预览
                    </el-link>
                    <el-link :href="fileUrl(scope.row.file_key)" target="_blank" type="primary">
                      下载
                    </el-link>
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="reimbursementBatchDetail">
              <el-divider>申请明细（报销批次）</el-divider>
              <el-descriptions :column="2" border>
                <el-descriptions-item label="批次号">{{ reimbursementBatchDetail.batch_no }}</el-descriptions-item>
                <el-descriptions-item label="状态">{{ reimbursementBatchDetail.status }}</el-descriptions-item>
                <el-descriptions-item label="所属项目">{{ toProjectLabel(reimbursementBatchDetail.project_id) }}</el-descriptions-item>
                <el-descriptions-item label="申请人">{{ toUserLabel(reimbursementBatchDetail.applicant_userid) }}</el-descriptions-item>
                <el-descriptions-item label="总金额">
                  {{ reimbursementAmountDisplay.lower }}（<strong>{{ reimbursementAmountDisplay.upper }}</strong>）
                </el-descriptions-item>
                <el-descriptions-item label="单据数">{{ reimbursementBatchDetail.item_count }}</el-descriptions-item>
              </el-descriptions>
              <el-table :data="reimbursementBatchDetail.items" size="small" border style="margin-top: 12px">
                <el-table-column prop="envelope_no" label="报销单号" min-width="150" />
                <el-table-column prop="invoice_no" label="发票号" min-width="150" />
                <el-table-column prop="amount" label="金额" width="120" />
                <el-table-column prop="category" label="类别" width="120" />
                <el-table-column prop="description" label="说明" min-width="220" />
              </el-table>
            </template>

            <template v-if="aiGateReviews.length > 0">
              <el-divider>AI审核结果</el-divider>
              <el-table :data="aiGateReviews" size="small" border>
                <el-table-column label="节点" min-width="130">
                  <template #default="scope">
                    {{ scope.row.node_key || "-" }}
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="scope">
                    <el-tag :type="aiGateTagType[scope.row.status] || 'info'" size="small">
                      {{ toStatusLabel(scope.row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="结论" width="120">
                  <template #default="scope">
                    <el-tag :type="normalizeAiReview(scope.row).outcomeTagType" size="small">
                      {{ normalizeAiReview(scope.row).outcomeLabel }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="总结" min-width="220">
                  <template #default="scope">
                    {{ normalizeAiReview(scope.row).summaryText }}
                  </template>
                </el-table-column>
                <el-table-column label="完成时间" width="170">
                  <template #default="scope">
                    {{ formatBeijingDateTime(scope.row.completed_at) }}
                  </template>
                </el-table-column>
              </el-table>
            </template>

            <template v-if="detail.instance.biz_type === 'reimbursement_batch'">
              <el-divider>报销批次AI审计报告</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[reimbursementAuditStatus] || 'info'">
                  {{ toStatusLabel(reimbursementAuditStatus) }}
                </el-tag>
              </div>
              <pre style="white-space: pre-wrap; word-break: break-word">{{
                reimbursementAuditReport || "-"
              }}</pre>
            </template>
          </el-card>
        </el-col>

        <el-col :md="10" :xs="24">
          <el-card shadow="never" header="审批流程">
            <div v-if="availableRounds.length > 1" style="margin-bottom: 12px">
              <el-radio-group v-model="selectedRound" size="small">
                <el-radio-button
                  v-for="r in availableRounds"
                  :key="r"
                  :value="r"
                >
                  第 {{ r }} 轮
                </el-radio-button>
              </el-radio-group>
            </div>

            <el-timeline>
              <el-timeline-item
                v-for="node in roundNodes"
                :key="node.id"
                :color="nodeStatusColor[node.status]"
                :hollow="node.status === 'pending'"
              >
                <div
                  :style="{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border:
                      detail.instance.current_node_key === node.node_key
                        ? '1px solid #2f6c5f'
                        : '1px solid transparent',
                    background:
                      detail.instance.current_node_key === node.node_key
                        ? '#f0f9f6'
                        : 'transparent'
                  }"
                >
                  <div
                    style="
                      display: flex;
                      align-items: center;
                      gap: 8px;
                      margin-bottom: 4px;
                    "
                  >
                    <strong>{{ node.node_name }}</strong>
                    <el-tag size="small" type="info">{{
                      nodeTypeLabelMap[node.node_type] ?? node.node_type
                    }}</el-tag>
                    <el-tag
                      size="small"
                      :type="node.status === 'completed' ? 'success' : 'info'"
                      >{{ toStatusLabel(node.status) }}</el-tag
                    >
                  </div>
                  <div style="font-size: 13px; color: #666; margin-bottom: 4px">
                    设定审批人：
                    <template v-if="getNodeAssignees(node.assignee_userids).length > 0">
                      {{ getNodeAssignees(node.assignee_userids).join("、") }}
                    </template>
                    <template v-else>-</template>
                  </div>
                  <div
                    v-for="task in getNodeTasks(node.id)"
                    :key="task.id"
                    style="font-size: 13px; color: #666; margin-top: 4px"
                  >
                    <span>{{ task.assignee_userid }}</span>
                    <el-tag
                      v-if="task.action"
                      :type="formatAiNodeDecisionTagType(task)"
                      size="small"
                      style="margin-left: 6px"
                      >{{ formatAiNodeDecision(task) }}</el-tag
                    >
                    <span v-if="task.assignee_userid === 'AI_GATE' && formatAiNodeComment(task)" style="margin-left: 6px; color: #666">
                      ：{{ formatAiNodeComment(task) }}
                    </span>
                    <span
                      v-if="task.acted_at"
                      style="margin-left: 6px; color: #999"
                      >{{ formatBeijingDateTime(task.acted_at) }}</span
                    >
                    <div v-if="task.comment && task.assignee_userid !== 'AI_GATE'" style="margin-top: 2px; color: #888; font-style: italic">
                      {{ task.comment }}
                    </div>
                  </div>
                </div>
              </el-timeline-item>
            </el-timeline>
          </el-card>
        </el-col>
      </el-row>

      <el-card
        v-if="detail.available_actions.length > 0"
        shadow="never"
        header="操作区"
        style="margin-top: 16px"
      >
        <el-input
          v-if="hasAction('approve') || hasAction('reject')"
          v-model="commentInput"
          type="textarea"
          :rows="3"
          placeholder="请输入审批意见（审批/驳回时必填）"
          style="margin-bottom: 12px"
        />
        <el-space>
          <el-button
            v-if="hasAction('approve')"
            type="success"
            :loading="actionLoading"
            @click="handleApprove"
          >
            审批通过
          </el-button>
          <el-button
            v-if="hasAction('reject')"
            type="danger"
            :loading="actionLoading"
            @click="handleReject"
          >
            驳回
          </el-button>
          <el-button
            v-if="
              hasAction('return_initiator') ||
              hasAction('return_prev') ||
              hasAction('return_to')
            "
            type="warning"
            :loading="actionLoading"
            @click="openReturnDialog"
          >
            退回
          </el-button>
          <el-button
            v-if="hasAction('transfer')"
            :loading="actionLoading"
            @click="openTransferDialog"
          >
            转办
          </el-button>
          <el-button
            v-if="hasAction('withdraw')"
            :loading="actionLoading"
            @click="handleWithdraw"
          >
            撤回
          </el-button>
          <el-button
            v-if="hasAction('cancel')"
            :loading="actionLoading"
            @click="handleCancel"
          >
            取消
          </el-button>
          <el-button
            v-if="hasAction('resubmit')"
            type="primary"
            :loading="actionLoading"
            @click="handleResubmit"
          >
            重新提交
          </el-button>
        </el-space>
      </el-card>
    </template>

    <el-drawer v-model="previewDrawerVisible" title="附件预览" size="70%">
      <div style="height: calc(100vh - 120px)">
        <div style="margin-bottom: 8px; color: #666">
          {{ previewFileName }}
        </div>
        <template v-if="previewInline">
          <iframe
            :src="previewFileUrl"
            style="width: 100%; height: 100%; border: none"
          />
        </template>
        <template v-else>
          <el-alert
            type="info"
            :closable="false"
            title="该文件类型暂不支持内嵌预览，请使用下载打开"
          />
          <div style="margin-top: 12px">
            <el-link :href="previewFileUrl" target="_blank" type="primary">下载附件</el-link>
          </div>
        </template>
      </div>
    </el-drawer>

    <el-dialog v-model="returnDialogVisible" title="退回审批" width="480px">
      <el-form label-width="80px">
        <el-form-item label="退回方式">
          <el-radio-group v-model="returnType">
            <el-radio value="initiator">退回发起人</el-radio>
            <el-radio value="prev">退回上一步</el-radio>
            <el-radio value="to">退回指定节点</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="returnType === 'to'" label="目标节点">
          <el-select v-model="returnTargetNodeKey" placeholder="选择节点">
            <el-option
              v-for="node in roundNodes.filter(n => n.status === 'completed')"
              :key="node.node_key"
              :label="node.node_name"
              :value="node.node_key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="退回意见">
          <el-input v-model="returnComment" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading" @click="handleReturn"
          >确定退回</el-button
        >
      </template>
    </el-dialog>

    <el-dialog v-model="transferDialogVisible" title="转办审批" width="480px">
      <el-form label-width="80px">
        <el-form-item label="转办给">
          <el-select
            v-model="transferToUserid"
            clearable
            filterable
            placeholder="选择公司人员"
            style="width: 100%"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="`${item.name} (${item.userid})`"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="转办原因">
          <el-input v-model="transferReason" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="actionLoading"
          @click="handleTransfer"
          >确定转办</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
