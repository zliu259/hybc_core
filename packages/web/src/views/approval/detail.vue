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
import { getRiskReport } from "@/api/payment";
import { getBatchAuditReport } from "@/api/reimbursement";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

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

const getNodeTasks = (nodeId: number): ApprovalTask[] => {
  if (!detail.value) return [];
  return detail.value.tasks.filter(t => t.node_instance_id === nodeId);
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

type TagType = "primary" | "success" | "warning" | "danger" | "info";
const paymentRiskStatus = ref("none");
const paymentRiskReport = ref<Record<string, unknown> | null>(null);
const reimbursementAuditStatus = ref("none");
const reimbursementAuditReport = ref<Record<string, unknown> | string | null>(
  null
);
const riskTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const result = await getApprovalDetail(instanceId.value);
    detail.value = result.data;
    selectedRound.value = result.data.instance.current_round;

    if (result.data.instance.biz_type === "payment_request") {
      const rr = await getRiskReport(result.data.instance.biz_id);
      paymentRiskStatus.value = rr.data.status;
      paymentRiskReport.value = rr.data.result;
      reimbursementAuditStatus.value = "none";
      reimbursementAuditReport.value = null;
    } else if (result.data.instance.biz_type === "reimbursement_batch") {
      const rr = await getBatchAuditReport(result.data.instance.biz_id);
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
  await Promise.all([loadDetail(), loadWecomUsers()]);
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
                detail.instance.biz_type
              }}</el-descriptions-item>
              <el-descriptions-item label="发起人">{{
                detail.instance.initiator_userid
              }}</el-descriptions-item>
              <el-descriptions-item label="状态">
                <el-tag size="small">{{ detail.instance.status }}</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="提交时间">{{
                detail.instance.submitted_at
              }}</el-descriptions-item>
              <el-descriptions-item label="完成时间">{{
                detail.instance.completed_at ?? "—"
              }}</el-descriptions-item>
              <el-descriptions-item label="摘要" :span="2">{{
                detail.instance.biz_summary
              }}</el-descriptions-item>
            </el-descriptions>

            <template v-if="detail.instance.biz_type === 'payment_request'">
              <el-divider>付款风险评估</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[paymentRiskStatus] || 'info'">
                  {{ paymentRiskStatus }}
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

            <template v-if="detail.instance.biz_type === 'reimbursement_batch'">
              <el-divider>报销批次AI审计报告</el-divider>
              <div style="margin-bottom: 8px">
                <el-tag :type="riskTagType[reimbursementAuditStatus] || 'info'">
                  {{ reimbursementAuditStatus }}
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
                      >{{ node.status }}</el-tag
                    >
                  </div>
                  <div
                    v-for="task in getNodeTasks(node.id)"
                    :key="task.id"
                    style="font-size: 13px; color: #666; margin-top: 4px"
                  >
                    <span>{{ task.assignee_userid }}</span>
                    <el-tag
                      v-if="task.action"
                      size="small"
                      style="margin-left: 6px"
                      >{{ task.action }}</el-tag
                    >
                    <span
                      v-if="task.acted_at"
                      style="margin-left: 6px; color: #999"
                      >{{ task.acted_at }}</span
                    >
                    <div
                      v-if="task.comment"
                      style="margin-top: 2px; color: #888; font-style: italic"
                    >
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
