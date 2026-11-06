<script setup lang="ts">
/**
 * 付款详情。阅读顺序与小程序、审批详情一致：头部（多少钱、付给谁）→ AI 审查 → 申请信息
 * → 付款执行 → 附件 → 审批流程。AI 审查和流程直接复用审批详情的组件，两边口径才不会走样。
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { getApprovalDetail, type ApprovalDetailResponse } from "@/api/approval";
import {
  getPaymentRequest,
  getRiskReport,
  type PaymentRequestDetail
} from "@/api/payment";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { toChineseAmount } from "@/utils/amount-cn";
import { message } from "@/utils/message";
import AiVerdictPanel from "@/views/approval/detail/components/AiVerdictPanel.vue";
import FlowTimeline from "@/views/approval/detail/components/FlowTimeline.vue";
import { toPaymentCategoryLabel } from "@/views/approval/detail/formatters";
import { buildStopNotice } from "@/views/approval/detail/notices";
import type { AiReport } from "@/views/approval/detail/useApprovalDetail";
import { formatBeijingDateTime } from "@/utils/datetime";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import FinSection from "../../shared/components/FinSection.vue";
import { resolvePaymentCapabilities } from "../payment-detail-view";
import {
  paymentStatusTagType,
  toPaymentMethodLabel,
  toPaymentStatusLabel
} from "../payment-labels";
import PaymentActions from "./PaymentActions.vue";
import PaymentAttachments from "./PaymentAttachments.vue";
import PaymentInfoCard from "./PaymentInfoCard.vue";
import PayoutPanel from "./PayoutPanel.vue";

defineOptions({ name: "PaymentDetailPanel" });

const props = withDefaults(
  defineProps<{ requestId: number; autoEdit?: boolean }>(),
  { autoEdit: false }
);
const emit = defineEmits<{ (e: "back"): void }>();

const NO_REPORT: AiReport = { status: "none", result: null };

const router = useRouter();
const userStore = useUserStoreHook();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const loading = ref(false);
const loadFailed = ref(false);
const detail = ref<PaymentRequestDetail | null>(null);
const approvalDetail = shallowRef<ApprovalDetailResponse | null>(null);
const report = shallowRef<AiReport>(NO_REPORT);
const superEditMode = ref(false);
const superEditNote = ref("");

const capabilities = computed(() =>
  resolvePaymentCapabilities({
    detail: detail.value,
    approvalDetail: approvalDetail.value,
    roles: userStore.roles ?? [],
    superEditMode: superEditMode.value
  })
);

const toUserLabel = (userid: string | null | undefined): string => {
  if (!userid) return "-";
  return wecomUsers.value.find(item => item.userid === userid)?.name || userid;
};

const payeeLabel = computed(() => {
  const payee = detail.value?.payee;
  if (!payee) return "-";
  const tail = payee.bank_account ? payee.bank_account.slice(-4) : "";
  return tail ? `${payee.name}（尾号${tail}）` : payee.name;
});

const projectLabel = computed(() => {
  const project = detail.value?.project;
  return project ? `${project.project_name} (${project.project_code})` : "-";
});

const amountUpper = computed(() =>
  detail.value ? toChineseAmount(detail.value.amount) : null
);

const waitingNodeName = computed(() => {
  const approval = approvalDetail.value;
  if (approval?.instance.status !== "in_progress") return "";
  const { current_node_key: key, current_round: round } = approval.instance;
  return (
    approval.nodes.find(node => node.node_key === key && node.round === round)
      ?.node_name ?? ""
  );
});

const stopNotice = computed(() =>
  approvalDetail.value
    ? buildStopNotice(approvalDetail.value, id => toUserLabel(id))
    : null
);

const aiGateReviews = computed(
  () => approvalDetail.value?.ai_gate_reviews ?? []
);
const aiVisible = computed(
  () =>
    aiGateReviews.value.length > 0 ||
    report.value.status !== "none" ||
    !!report.value.result ||
    !!detail.value?.ai_risk_result
);

/** 操作后的刷新不闪遮罩；风控报告和审批流程取不到都不挡付款单本身。 */
const refresh = async () => {
  const { data } = await getPaymentRequest(props.requestId);
  const instanceId = data.approval_instance_id;
  const [riskResult, approvalResult] = await Promise.allSettled([
    getRiskReport(props.requestId),
    instanceId ? getApprovalDetail(instanceId) : Promise.resolve(null)
  ]);
  detail.value = data;
  report.value =
    riskResult.status === "fulfilled"
      ? {
          status: riskResult.value.data.status,
          result: riskResult.value.data.result
        }
      : NO_REPORT;
  approvalDetail.value =
    approvalResult.status === "fulfilled" && approvalResult.value
      ? approvalResult.value.data
      : null;
};

const silentRefresh = async () => {
  try {
    await refresh();
  } catch (error) {
    message(resolveApiErrorMessage(error, "付款详情刷新失败"), {
      type: "error"
    });
  }
};

const load = async () => {
  loading.value = true;
  loadFailed.value = false;
  try {
    await refresh();
  } catch (error) {
    loadFailed.value = true;
    console.error("[payment-detail] load failed", error);
  } finally {
    loading.value = false;
  }
};

const goToApprovalDetail = () => {
  const id = detail.value?.approval_instance_id;
  if (id) router.push(`/approval/detail/${id}`);
};

onMounted(() => {
  // 通讯录只影响姓名显示，失败时回退显示 userid，不阻塞详情
  void loadWecomUsers().catch(() => undefined);
  void load();
});
</script>

<template>
  <div v-loading="loading" class="payment-detail-panel">
    <el-result
      v-if="loadFailed && !detail"
      icon="error"
      title="付款详情没有加载出来"
      sub-title="可能是网络中断，或者这张付款单不存在、你没有查看权限"
    >
      <template #extra>
        <el-button type="primary" @click="load">重新加载</el-button>
        <el-button @click="emit('back')">返回</el-button>
      </template>
    </el-result>

    <template v-else>
      <FinanceDetailHeader
        serial-label="流水号"
        :serial="detail?.serial_no ?? null"
        amount-label="申请金额"
        :amount="detail?.amount"
        :amount-cn="amountUpper"
      >
        <template #tags>
          <el-tag
            v-if="detail"
            :type="paymentStatusTagType[detail.status] ?? 'info'"
          >
            {{ toPaymentStatusLabel(detail.status) }}
          </el-tag>
          <el-tag v-if="detail?.legacy_data_id" size="small" type="info">
            历史数据
          </el-tag>
          <span v-if="waitingNodeName" class="payment-detail-panel__waiting">
            等待{{ waitingNodeName }}
          </span>
        </template>
        <template #meta>
          <span v-if="detail?.content" class="payment-detail-panel__content">
            {{ detail.content }}
          </span>
          <span>所属项目：{{ projectLabel }}</span>
          <span>收款方：{{ payeeLabel }}</span>
          <span>
            付款单位：{{ detail?.payment_entity?.entity_name || "尚未指定" }}
          </span>
          <span>付款类别：{{ toPaymentCategoryLabel(detail?.category) }}</span>
          <span>
            付款方式：{{ toPaymentMethodLabel(detail?.payment_method) }}
          </span>
          <span>预计付款日：{{ detail?.expected_payment_date || "-" }}</span>
          <span>申请人：{{ toUserLabel(detail?.applicant_userid) }}</span>
        </template>
        <template #actions>
          <el-button @click="emit('back')">返回</el-button>
          <el-button v-if="approvalDetail" @click="goToApprovalDetail">
            查看审批详情
          </el-button>
          <PaymentActions
            :detail="detail"
            :capabilities="capabilities"
            :wecom-users="wecomUsers"
            @refresh="silentRefresh"
          />
        </template>
      </FinanceDetailHeader>

      <el-alert
        v-if="stopNotice"
        :type="stopNotice.kind === 'rejected' ? 'error' : 'warning'"
        :closable="false"
        show-icon
        :title="stopNotice.title"
      >
        <span v-if="stopNotice.by">{{ stopNotice.by }}：</span
        >{{ stopNotice.comment }}
        <time v-if="stopNotice.at" class="payment-detail-panel__notice-time">
          {{ formatBeijingDateTime(stopNotice.at) }}
        </time>
      </el-alert>

      <div v-if="detail" class="payment-detail-panel__sections">
        <AiVerdictPanel
          v-if="aiVisible"
          :reviews="aiGateReviews"
          biz-type="payment_request"
          :report="report"
          :payment-result="detail.ai_risk_result"
        />

        <PaymentInfoCard
          v-model:super-edit-mode="superEditMode"
          v-model:super-edit-note="superEditNote"
          :detail="detail"
          :capabilities="capabilities"
          :auto-edit="autoEdit"
          :to-user-label="toUserLabel"
          @refresh="silentRefresh"
        />

        <PayoutPanel
          :detail="detail"
          :can-adjust="capabilities.canAdjustPayout"
          :super-edit-mode="superEditMode"
          :super-edit-note="superEditNote"
          :to-user-label="toUserLabel"
          @refresh="silentRefresh"
        />

        <PaymentAttachments
          :detail="detail"
          :upload-via="capabilities.attachmentUploadVia"
          :can-remove="capabilities.canRemoveAttachment"
          :super-edit-mode="superEditMode"
          :super-edit-note="superEditNote"
          @refresh="silentRefresh"
        />

        <FlowTimeline
          v-if="approvalDetail"
          :nodes="approvalDetail.nodes"
          :tasks="approvalDetail.tasks"
          :current-node-key="approvalDetail.instance.current_node_key"
          :current-round="approvalDetail.instance.current_round"
          :is-super-admin="false"
          :to-user-label="toUserLabel"
        />
        <FinSection v-else-if="detail.approval_instance_id" title="审批流程">
          <p class="payment-detail-panel__note">
            暂时看不到审批流程：可能没有查看权限，或者网络中断。
          </p>
        </FinSection>
      </div>
    </template>
  </div>
</template>

<style scoped>
.payment-detail-panel {
  min-height: 240px;
}

.payment-detail-panel__content {
  flex-basis: 100%;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  color: #3f3527;
  word-break: break-word;
}

.payment-detail-panel__waiting {
  font-size: 13px;
  color: #8c6a2f;
}

.payment-detail-panel__note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #6e6458;
}

.payment-detail-panel__notice-time {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

/* 复用的审批详情面板换成财务页的分节样式，整页看起来是一套 */
.payment-detail-panel__sections :deep(.approval-panel) {
  padding: 0;
  margin-top: 20px;
  background: transparent;
  border: none;
  border-radius: 0;
}

.payment-detail-panel__sections :deep(.approval-panel__head) {
  gap: 10px;
  justify-content: flex-start;
  margin-bottom: 10px;
}

.payment-detail-panel__sections :deep(.approval-panel__head)::after {
  flex: 1;
  order: 1;
  content: "";
  border-top: 1px dashed #e3d5b8;
}

.payment-detail-panel__sections :deep(.approval-panel__head > *) {
  order: 2;
}

.payment-detail-panel__sections :deep(.approval-panel__title) {
  flex-shrink: 0;
  order: 0;
  padding-left: 8px;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  color: #6b4f2a;
  letter-spacing: 0.06em;
  border-left: 3px solid #c9a35c;
}
</style>
