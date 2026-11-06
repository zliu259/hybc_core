<script setup lang="ts">
/**
 * 审批详情。审批人的任务只有一个：看清这笔钱，然后做决定。
 * 主栏从结论到依据（金额 → AI 结论 → 明细 → 附件），决定和流程固定在右栏，
 * 不必滚到页面底部才能操作。业务逻辑拆在 ./detail/ 下。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import type { ApprovalTask } from "@/api/approval";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { formatBeijingDateTime } from "@/utils/datetime";
import { buildBizView } from "./detail/biz-view";
import ActionDialogs from "./detail/components/ActionDialogs.vue";
import AiVerdictPanel from "./detail/components/AiVerdictPanel.vue";
import ApprovalHero from "./detail/components/ApprovalHero.vue";
import AttachmentPanel from "./detail/components/AttachmentPanel.vue";
import AttachmentPreviewDrawer from "./detail/components/AttachmentPreviewDrawer.vue";
import BizDetailPanel from "./detail/components/BizDetailPanel.vue";
import BizItemTables from "./detail/components/BizItemTables.vue";
import DecisionPanel from "./detail/components/DecisionPanel.vue";
import FlowTimeline from "./detail/components/FlowTimeline.vue";
import {
  parseAttachments,
  parseInvoiceItems,
  splitRemark
} from "./detail/formatters";
import { buildStopNotice, stopNoticeAlertType } from "./detail/notices";
import type { AttachmentItem, LabelContext } from "./detail/types";
import { useApprovalActions } from "./detail/useApprovalActions";
import { useApprovalDetail } from "./detail/useApprovalDetail";
import { useAttachmentPreview } from "./detail/useAttachmentPreview";
import { usePayoutPlan } from "./detail/usePayoutPlan";
import { toBizTypeLabel } from "./labels";

defineOptions({ name: "ApprovalDetail" });

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const PENDING_ROUTE: RouteLocationRaw = { path: "/approval/index" };

const instanceId = computed(() => Number(route.params.id));
const roles = computed(() => userStore.roles ?? []);
const isSuperAdmin = computed(() => roles.value.includes("super_admin"));

const {
  detail,
  instance,
  records,
  report,
  aiGateReviews,
  bizLoading,
  loadFailed,
  hasAction,
  load
} = useApprovalDetail(instanceId);

// 名称映射在后台补齐：没到之前先显示编号，到了原地替换，不阻塞页面渲染
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const { projects, loadProjects } = useProjectOptions();
const entities = ref<Entity[]>([]);

const toUserLabel = (userid: string | null | undefined): string => {
  if (!userid) return "-";
  const user = wecomUsers.value.find(item => item.userid === userid);
  return user?.name || userid;
};

const labelContext = computed<LabelContext>(() => ({
  project: id =>
    typeof id === "number"
      ? (projects.value.find(item => item.id === id)?.project_name ??
        String(id))
      : "-",
  entity: id =>
    typeof id === "number"
      ? (entities.value.find(item => item.id === id)?.entity_name ?? String(id))
      : "-",
  user: toUserLabel,
  canOpenFinance: ["super_admin", "manager", "finance"].some(role =>
    roles.value.includes(role)
  )
}));

const bizView = computed(() =>
  instance.value
    ? buildBizView(instance.value, records.value, labelContext.value)
    : null
);

const stopNotice = computed(() =>
  detail.value
    ? buildStopNotice(detail.value, toUserLabel, records.value.payment?.remark)
    : null
);

const currentNodeName = computed(() => {
  const current = instance.value;
  if (!current || !detail.value) return null;
  return (
    detail.value.nodes.find(
      node =>
        node.node_key === current.current_node_key &&
        node.round === current.current_round
    )?.node_name ?? null
  );
});

const payout = usePayoutPlan({ records, entities, isSuperAdmin, hasAction });
const actions = useApprovalActions({
  instanceId,
  payout,
  isSuperAdmin,
  reload: load
});
const preview = useAttachmentPreview();

const attachments = computed<AttachmentItem[] | null>(() => {
  const { payment, contract, amountChange } = records.value;
  if (payment) return parseAttachments(payment.attachments_json);
  if (contract) return parseAttachments(contract.attachments_json);
  if (amountChange) return amountChange.attachments;
  return null;
});

const canUpload = computed(
  () =>
    Boolean(records.value.payment || records.value.contract) &&
    (isSuperAdmin.value ||
      [
        "approve",
        "reject",
        "return_prev",
        "return_to",
        "return_initiator"
      ].some(hasAction))
);

const remarkEdits = computed(
  () => splitRemark(records.value.payment?.remark).edits
);

const invoiceItems = computed(() =>
  parseInvoiceItems(records.value.invoiceRequest?.items_json)
);

const hasDecisionPanel = computed(
  () => (detail.value?.available_actions.length ?? 0) > 0
);

const returnVisible = ref(false);
const transferVisible = ref(false);
const forceTask = ref<ApprovalTask | null>(null);

const previewTableAttachment = (fileKey: string, fileName: string) => {
  const item = { file_key: fileKey, file_name: fileName };
  return preview.open([item], item);
};

const pageTop = ref<HTMLElement | null>(null);

const goBack = () => {
  const from = route.query.from;
  if (from === "monitor") {
    router.push({ path: "/approval/admin-monitor" });
    return;
  }
  if (from !== "desk" && window.history.state?.back) {
    router.back();
    return;
  }
  router.push(PENDING_ROUTE);
};

// 兜底：若布局不再按路径重建，路由参数变化时也要加载新单据
watch(instanceId, () => {
  void load();
});

onMounted(() => {
  // 布局按完整路径重建页面，但滚动位置留在外层容器，换单后要回到顶部
  pageTop.value?.scrollIntoView({ block: "start" });
  void load();
  void Promise.allSettled([
    loadWecomUsers(),
    loadProjects(),
    listEntities().then(result => {
      entities.value = result.data;
    })
  ]);
});
</script>

<template>
  <div ref="pageTop" class="approval-detail">
    <el-page-header class="approval-detail__header" @back="goBack">
      <template #content>
        <span class="approval-detail__no">
          {{ instance?.instance_no ?? "审批详情" }}
        </span>
      </template>
    </el-page-header>

    <el-result
      v-if="loadFailed && !detail"
      icon="error"
      title="审批详情没有加载出来"
      sub-title="可能是网络中断，或者你没有查看这笔审批的权限"
    >
      <template #extra>
        <el-button type="primary" @click="load">重新加载</el-button>
        <el-button @click="goBack">返回</el-button>
      </template>
    </el-result>

    <div v-else-if="!detail || !bizView" class="approval-detail__layout">
      <div class="approval-detail__main">
        <div class="approval-detail__skeleton">
          <el-skeleton :rows="4" animated />
        </div>
        <div class="approval-detail__skeleton">
          <el-skeleton :rows="3" animated />
        </div>
      </div>
      <div class="approval-detail__skeleton">
        <el-skeleton :rows="5" animated />
      </div>
    </div>

    <template v-else>
      <el-alert
        v-if="stopNotice"
        :type="stopNoticeAlertType(stopNotice.kind)"
        :closable="false"
        show-icon
        :title="stopNotice.title"
        class="approval-detail__notice"
      >
        <span v-if="stopNotice.by">{{ stopNotice.by }}：</span
        >{{ stopNotice.comment }}
        <time v-if="stopNotice.at" class="approval-detail__notice-time">
          {{ formatBeijingDateTime(stopNotice.at) }}
        </time>
      </el-alert>

      <div class="approval-detail__layout">
        <main class="approval-detail__main">
          <ApprovalHero
            :hero="bizView.hero"
            :biz-type-label="toBizTypeLabel(detail.instance.biz_type)"
            :status="detail.instance.status"
            :current-node-name="currentNodeName"
          />

          <AiVerdictPanel
            :reviews="aiGateReviews"
            :biz-type="detail.instance.biz_type"
            :report="report"
            :contract-result="records.contract?.ai_review_result"
            :contract-status="records.contract?.ai_review_status"
            :payment-result="records.payment?.ai_risk_result"
          />

          <BizDetailPanel
            v-if="bizLoading || bizView.rows.length > 0"
            :title="bizView.detailTitle"
            :rows="bizView.rows"
            :loading="bizLoading"
            :edits="remarkEdits"
            :to-user-label="toUserLabel"
          >
            <BizItemTables
              :reimbursement-items="records.reimbursementBatch?.items"
              :invoice-items="invoiceItems"
              @preview="previewTableAttachment"
              @download="preview.download"
            />
          </BizDetailPanel>

          <AttachmentPanel
            v-if="attachments"
            :items="attachments"
            :can-upload="canUpload"
            :uploading="actions.uploading.value"
            :upload="actions.uploadAttachment"
            :empty-text="
              records.amountChange ? '申请人没有上传附件' : '还没有附件'
            "
            @preview="item => preview.open(attachments ?? [], item)"
            @download="item => preview.download(item.file_key)"
          />
        </main>

        <aside class="approval-detail__rail">
          <DecisionPanel
            v-if="hasDecisionPanel"
            class="approval-detail__decision"
            :available-actions="detail.available_actions"
            :actions="actions"
            :payout="payout"
            :entities="entities"
            @return="returnVisible = true"
            @transfer="transferVisible = true"
          />
          <FlowTimeline
            :nodes="detail.nodes"
            :tasks="detail.tasks"
            :current-node-key="detail.instance.current_node_key"
            :current-round="detail.instance.current_round"
            :instance-status="detail.instance.status"
            :is-super-admin="isSuperAdmin"
            :to-user-label="toUserLabel"
            @force-transfer="task => (forceTask = task)"
          />
        </aside>
      </div>

      <ActionDialogs
        v-model:return-visible="returnVisible"
        v-model:transfer-visible="transferVisible"
        v-model:force-task="forceTask"
        :available-actions="detail.available_actions"
        :nodes="detail.nodes"
        :current-round="detail.instance.current_round"
        :users="wecomUsers"
        :default-comment="actions.comment.value"
        :pending-action="actions.pendingAction.value"
        :to-user-label="toUserLabel"
        @submit-return="actions.submitReturn"
        @submit-transfer="actions.submitTransfer"
        @submit-force-transfer="actions.submitForceTransfer"
      />
    </template>

    <AttachmentPreviewDrawer
      v-model:visible="preview.visible.value"
      :url="preview.url.value"
      :file-name="preview.fileName.value"
      :index="preview.index.value"
      :total="preview.list.value.length"
      @step="preview.step"
    />
  </div>
</template>

<style scoped>
.approval-detail {
  scroll-margin-top: 16px;
}

.approval-detail__header {
  margin-bottom: 12px;
}

.approval-detail__no {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-regular);
}

.approval-detail__notice {
  margin-bottom: 12px;
}

.approval-detail__notice-time {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.approval-detail__layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 12px;
  align-items: start;
}

.approval-detail__main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.approval-detail__rail {
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100vh - 124px);
  overflow-y: auto;
  scrollbar-width: thin;
}

.approval-detail__decision {
  position: sticky;
  top: 0;
  z-index: 2;
  flex: none;
}

.approval-detail__skeleton {
  padding: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

@media (width <= 1080px) {
  .approval-detail__layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .approval-detail__rail {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .approval-detail__decision {
    position: static;
  }
}
</style>

<style>
/*
 * 全局布局给滚动区内联了 overflow:hidden，它会成为 sticky 的参照物，右栏就吸不住了。
 * 只在本页改成 clip：视觉一样，但不构成滚动容器。不支持 :has 的浏览器退化为右栏随页面滚动。
 */
.el-scrollbar__view:has(.approval-detail) {
  overflow: clip !important;
}
</style>
