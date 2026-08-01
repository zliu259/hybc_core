<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { PaymentRequestDetail } from "@/api/payment";
import type { ApprovalDetailResponse } from "@/api/approval";
import type { WeComUser } from "@/api/wecom";
import type { PaymentTagType } from "../payment-labels";

defineOptions({ name: "PaymentApprovalActionPanel" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  approvalDetail: ApprovalDetailResponse | null;
  riskStatus: string;
  riskReport: Record<string, unknown> | null;
  wecomUsers: WeComUser[];
}>();

const router = useRouter();

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const item of props.wecomUsers) {
    map.set(item.userid, item.name || item.userid);
  }
  return map;
});

const toUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const riskTagType: Record<string, PaymentTagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};
const riskStatusLabelMap: Record<string, string> = {
  none: "未触发",
  pending: "评估中",
  completed: "已完成",
  failed: "评估失败"
};

const approvalStatusLabelMap: Record<string, string> = {
  pending: "待处理",
  in_progress: "审批中",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已取消",
  withdrawn: "已撤回",
  completed: "已完成"
};

const nodeTypeLabelMap: Record<string, string> = {
  start: "发起",
  approval: "审批",
  ai_gate: "AI审核",
  cc: "抄送",
  condition: "条件",
  parallel: "并行",
  end: "结束"
};

const nodeStatusLabelMap: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  rejected: "已驳回",
  skipped: "已跳过",
  cancelled: "已取消"
};

const aiReviewStatusLabelMap: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  failed: "失败"
};

const aiOutcomeLabelMap: Record<string, string> = {
  approve: "通过",
  reject: "驳回"
};

const riskLevelLabelMap: Record<string, string> = {
  high: "高风险",
  medium: "中风险",
  low: "低风险"
};

const riskLevelTagTypeMap: Record<string, PaymentTagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toRiskLevelLabel = (level: unknown) => {
  if (typeof level !== "string" || !level) return "-";
  return riskLevelLabelMap[level] ?? level;
};

const toRiskStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return riskStatusLabelMap[status] ?? status;
};

const toApprovalStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return approvalStatusLabelMap[status] ?? status;
};

const toNodeTypeLabel = (type: string | null | undefined) => {
  if (!type) return "-";
  return nodeTypeLabelMap[type] ?? type;
};

const toNodeStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return nodeStatusLabelMap[status] ?? status;
};

const toAiReviewStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return aiReviewStatusLabelMap[status] ?? status;
};

const toAiOutcomeLabel = (outcome: string | null | undefined) => {
  if (!outcome) return "-";
  return aiOutcomeLabelMap[outcome] ?? outcome;
};

const toRiskLevelTagType = (level: unknown): PaymentTagType => {
  if (typeof level !== "string" || !level) return "info";
  return riskLevelTagTypeMap[level] ?? "info";
};

const currentNodeLabel = computed(() => {
  const key = props.approvalDetail?.instance.current_node_key;
  if (!key) return "-";
  const node = props.approvalDetail?.nodes.find(item => item.node_key === key);
  return node?.node_name ?? key;
});

const roundNodes = computed(() => {
  if (!props.approvalDetail) return [];
  return props.approvalDetail.nodes
    .filter(item => item.round === props.approvalDetail?.instance.current_round)
    .sort((a, b) => a.sort_order - b.sort_order);
});

const getNodeTasks = (nodeId: number) => {
  if (!props.approvalDetail) return [];
  return props.approvalDetail.tasks.filter(
    item => item.node_instance_id === nodeId
  );
};

const aiGateReviews = computed(
  () => props.approvalDetail?.ai_gate_reviews ?? []
);

const toActionLabel = (action: string | null) => {
  if (!action) return "待处理";
  if (action === "approve") return "通过";
  if (action === "reject") return "驳回";
  if (action === "return_initiator") return "退回发起人";
  if (action === "return_prev") return "退回上一步";
  if (action === "return_to") return "退回指定节点";
  if (action === "transfer") return "转办";
  return action;
};

const goToApprovalDetail = () => {
  const approvalInstanceId = props.detail?.approval_instance_id;
  if (!approvalInstanceId) return;
  router.push(`/approval/detail/${approvalInstanceId}`);
};
</script>

<template>
  <div v-if="detail?.approval_instance_id" style="margin-bottom: 12px">
    <el-button type="info" plain @click="goToApprovalDetail">
      查看审批详情
    </el-button>
  </div>

  <el-divider v-if="detail">AI风险评估</el-divider>
  <div v-if="detail" style="margin-bottom: 8px">
    <el-tag :type="riskTagType[riskStatus] || 'info'">{{
      toRiskStatusLabel(riskStatus)
    }}</el-tag>
  </div>
  <el-descriptions v-if="riskReport" :column="2" border>
    <el-descriptions-item label="风险等级">
      <el-tag :type="toRiskLevelTagType(riskReport.overall_risk)">
        {{ toRiskLevelLabel(riskReport.overall_risk) }}
      </el-tag>
    </el-descriptions-item>
    <el-descriptions-item label="风险分数">{{
      riskReport.score ?? "-"
    }}</el-descriptions-item>
    <el-descriptions-item label="总结" :span="2">{{
      riskReport.summary || "-"
    }}</el-descriptions-item>
    <el-descriptions-item label="建议" :span="2">
      {{
        Array.isArray(riskReport.recommendations)
          ? riskReport.recommendations.join("；")
          : "-"
      }}
    </el-descriptions-item>
  </el-descriptions>

  <el-divider v-if="approvalDetail">审批信息</el-divider>
  <el-descriptions v-if="approvalDetail" :column="2" border>
    <el-descriptions-item label="审批单号">
      {{ approvalDetail.instance.instance_no }}
    </el-descriptions-item>
    <el-descriptions-item label="审批状态">
      {{ toApprovalStatusLabel(approvalDetail.instance.status) }}
    </el-descriptions-item>
    <el-descriptions-item label="当前节点">
      {{ currentNodeLabel }}
    </el-descriptions-item>
    <el-descriptions-item label="发起人">
      {{ toUserLabel(approvalDetail.instance.initiator_userid) }}
    </el-descriptions-item>
  </el-descriptions>

  <el-table
    v-if="approvalDetail"
    :data="roundNodes"
    size="small"
    style="margin-top: 12px"
  >
    <el-table-column prop="node_name" label="节点" min-width="140" />
    <el-table-column label="类型" width="120">
      <template #default="scope">{{
        toNodeTypeLabel(scope.row.node_type)
      }}</template>
    </el-table-column>
    <el-table-column label="状态" width="110">
      <template #default="scope">{{
        toNodeStatusLabel(scope.row.status)
      }}</template>
    </el-table-column>
    <el-table-column label="审批意见" min-width="260">
      <template #default="scope">
        <template v-if="getNodeTasks(scope.row.id).length">
          <div
            v-for="task in getNodeTasks(scope.row.id)"
            :key="task.id"
            style="margin-bottom: 4px"
          >
            {{ toUserLabel(task.assignee_userid) }}：{{
              toActionLabel(task.action)
            }}
            <span v-if="task.comment">（{{ task.comment }}）</span>
          </div>
        </template>
        <span v-else>-</span>
      </template>
    </el-table-column>
  </el-table>

  <el-divider v-if="aiGateReviews.length > 0">AI审核意见</el-divider>
  <el-table v-if="aiGateReviews.length > 0" :data="aiGateReviews" size="small">
    <el-table-column prop="node_key" label="节点" width="160" />
    <el-table-column label="状态" width="100">
      <template #default="scope">{{
        toAiReviewStatusLabel(scope.row.status)
      }}</template>
    </el-table-column>
    <el-table-column label="结论" width="100">
      <template #default="scope">{{
        toAiOutcomeLabel(scope.row.outcome)
      }}</template>
    </el-table-column>
    <el-table-column label="总结/意见" min-width="260">
      <template #default="scope">{{
        scope.row.summary || scope.row.comment || "-"
      }}</template>
    </el-table-column>
    <el-table-column label="建议" min-width="260">
      <template #default="scope">
        {{
          Array.isArray(scope.row.recommendations) &&
          scope.row.recommendations.length > 0
            ? scope.row.recommendations.join("；")
            : "-"
        }}
      </template>
    </el-table-column>
  </el-table>
</template>
