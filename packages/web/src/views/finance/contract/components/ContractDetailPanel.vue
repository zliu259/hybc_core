<script setup lang="ts">
/**
 * 合同详情。阅读顺序与付款详情、小程序一致：头部（多少钱、和谁签、执行到哪了）→ AI 审查
 * → 合同信息 → 付款或开票收款 → 金额变更 → 附件 → 审批流程。
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { getApprovalDetail, type ApprovalDetailResponse } from "@/api/approval";
import {
  getContract,
  updateContract,
  type ContractDetail
} from "@/api/contract";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { toChineseAmount } from "@/utils/amount-cn";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatBeijingDateTime } from "@/utils/datetime";
import { contractTypeLabel } from "@/utils/enum-labels";
import { message } from "@/utils/message";
import AiVerdictPanel from "@/views/approval/detail/components/AiVerdictPanel.vue";
import FlowTimeline from "@/views/approval/detail/components/FlowTimeline.vue";
import { parseAttachments } from "@/views/approval/detail/formatters";
import {
  buildStopNotice,
  stopNoticeAlertType
} from "@/views/approval/detail/notices";
import type { AttachmentItem } from "@/views/approval/detail/types";
import type { AiReport } from "@/views/approval/detail/useApprovalDetail";
import { waitingNodeName as resolveWaitingNode } from "../../shared/approval-view";
import BizAttachments from "../../shared/components/BizAttachments.vue";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import FinPanels from "../../shared/components/FinPanels.vue";
import FinSection from "../../shared/components/FinSection.vue";
import type { AttachmentUploadRoute } from "../../shared/format";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TAGS,
  resolveContractCapabilities
} from "../contract-detail-view";
import ContractActions from "./ContractActions.vue";
import ContractAmountChanges from "./ContractAmountChanges.vue";
import ContractInboundRecords from "./ContractInboundRecords.vue";
import ContractInfoSection from "./ContractInfoSection.vue";
import ContractPayments from "./ContractPayments.vue";
import ContractProgress from "./ContractProgress.vue";

defineOptions({ name: "ContractDetailPanel" });

const props = defineProps<{
  contractId?: number;
  initialDirection?: "inbound" | "outbound";
}>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "created", id: number): void;
  /** 面板内发起了页面级跳转（如去开票），宿主抽屉应随之关闭 */
  (e: "nav"): void;
}>();

/** 合同的报告在业务记录上，这个入参只有付款、报销才用 */
const NO_REPORT: AiReport = { status: "none", result: null };

const router = useRouter();
const userStore = useUserStoreHook();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const isCreate = computed(() => props.contractId === undefined);
const loading = ref(false);
const loadFailed = ref(false);
const detail = ref<ContractDetail | null>(null);
const approvalDetail = shallowRef<ApprovalDetailResponse | null>(null);
const editing = ref(false);
const superEditMode = ref(false);
const superEditNote = ref("");
/** 新建时合同还没落库，附件先记在这里，随合同一起创建 */
const draftAttachments = ref<AttachmentItem[]>([]);

const roles = computed<readonly string[]>(() => userStore.roles ?? []);

const capabilities = computed(() =>
  resolveContractCapabilities({
    detail: detail.value,
    approvalDetail: approvalDetail.value,
    roles: roles.value,
    superEditMode: superEditMode.value
  })
);

const toUserLabel = (userid: string | null | undefined): string => {
  if (!userid) return "-";
  return wecomUsers.value.find(item => item.userid === userid)?.name || userid;
};

const serializeAttachments = (items: AttachmentItem[]): string =>
  JSON.stringify(
    items.map(item => ({
      file_key: item.file_key,
      file_name: item.file_name,
      file_size: item.file_size ?? undefined
    }))
  );

const draftAttachmentsJson = computed(() =>
  serializeAttachments(draftAttachments.value)
);

const attachmentItems = computed(() =>
  isCreate.value
    ? draftAttachments.value
    : parseAttachments(detail.value?.attachments_json ?? null)
);

const uploadVia = computed<AttachmentUploadRoute>(() =>
  isCreate.value ? "biz" : capabilities.value.attachmentUploadVia
);

const canRemoveAttachment = computed(
  () => isCreate.value || capabilities.value.canRemoveAttachment
);

const attachmentBlockedReason = computed(() =>
  superEditMode.value && !superEditNote.value.trim()
    ? "超管编辑模式下必须填写修改说明"
    : ""
);

const persistAttachments = async (next: AttachmentItem[]) => {
  if (isCreate.value) {
    draftAttachments.value = next;
    return;
  }
  await updateContract(props.contractId as number, {
    attachments_json: serializeAttachments(next),
    ...(superEditMode.value
      ? { admin_edit_mode: true, edit_note: superEditNote.value.trim() }
      : {})
  });
};

const waitingNodeName = computed(() =>
  resolveWaitingNode(approvalDetail.value)
);

const stopNotice = computed(() =>
  approvalDetail.value
    ? buildStopNotice(approvalDetail.value, id => toUserLabel(id))
    : null
);

const isEditing = computed(
  () => isCreate.value || (editing.value && capabilities.value.canEditFields)
);

const aiGateReviews = computed(
  () => approvalDetail.value?.ai_gate_reviews ?? []
);
const aiVisible = computed(
  () =>
    aiGateReviews.value.length > 0 ||
    (detail.value?.ai_review_status ?? "none") !== "none" ||
    !!detail.value?.ai_review_result
);
const aiBizType = computed(() =>
  detail.value?.direction === "inbound"
    ? "inbound_contract"
    : "outbound_contract"
);

/** 操作后的刷新不闪遮罩；审批流程取不到不挡合同本身。 */
const refresh = async () => {
  const id = props.contractId;
  if (id === undefined) return;
  const { data } = await getContract(id);
  const [approvalResult] = await Promise.allSettled([
    data.approval_instance_id
      ? getApprovalDetail(data.approval_instance_id)
      : Promise.resolve(null)
  ]);
  detail.value = data;
  approvalDetail.value =
    approvalResult.status === "fulfilled" && approvalResult.value
      ? approvalResult.value.data
      : null;
};

const silentRefresh = async () => {
  try {
    await refresh();
  } catch (error) {
    message(resolveApiErrorMessage(error, "合同详情刷新失败"), {
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
    console.error("[contract-detail] load failed", error);
  } finally {
    loading.value = false;
  }
};

const goToApprovalDetail = () => {
  const id = detail.value?.approval_instance_id;
  if (!id) return;
  router.push(`/approval/detail/${id}`);
  emit("nav");
};

onMounted(() => {
  // 通讯录只影响姓名显示和经办人选项，失败时回退显示 userid，不阻塞详情
  void loadWecomUsers().catch(() => undefined);
  void load();
});
</script>

<template>
  <div v-loading="loading" class="contract-detail-panel">
    <el-result
      v-if="loadFailed && !detail"
      icon="error"
      title="合同详情没有加载出来"
      sub-title="可能是网络中断，或者这份合同不存在、你没有查看权限"
    >
      <template #extra>
        <el-button type="primary" @click="load">重新加载</el-button>
        <el-button @click="emit('back')">返回</el-button>
      </template>
    </el-result>

    <template v-else>
      <header v-if="isCreate" class="create-masthead">
        <span class="create-masthead__title">新建合同</span>
        <el-button @click="emit('back')">返回</el-button>
      </header>

      <FinanceDetailHeader
        v-else
        serial-label="合同号"
        :serial="detail?.contract_no ?? null"
        amount-label="合同金额"
        :amount="detail?.total_amount ?? null"
        :amount-cn="detail ? toChineseAmount(detail.total_amount) : null"
      >
        <template #tags>
          <el-tag
            v-if="detail"
            :type="detail.direction === 'outbound' ? 'warning' : 'success'"
          >
            {{ detail.direction === "outbound" ? "对外付款" : "收款" }}
          </el-tag>
          <el-tag
            v-if="detail"
            :type="CONTRACT_STATUS_TAGS[detail.status] || 'info'"
          >
            {{ CONTRACT_STATUS_LABELS[detail.status] || detail.status }}
          </el-tag>
          <el-tag v-if="detail?.legacy_data_id" size="small" type="info">
            历史数据
          </el-tag>
          <span v-if="waitingNodeName" class="contract-detail-panel__waiting">
            等待{{ waitingNodeName }}
          </span>
        </template>
        <template #meta>
          <span v-if="detail" class="contract-detail-panel__title">
            {{ detail.counterparty }}
            <template v-if="detail.contract_type">
              · {{ contractTypeLabel(detail.contract_type) }}
            </template>
          </span>
          <span>所属项目：{{ detail?.project?.project_name || "-" }}</span>
          <span>我方主体：{{ detail?.entity?.entity_name || "-" }}</span>
          <span>合同日期：{{ detail?.contract_date || "-" }}</span>
          <span>经办人：{{ toUserLabel(detail?.handler_userid) }}</span>
        </template>
        <template #actions>
          <el-button @click="emit('back')">返回</el-button>
          <el-button v-if="approvalDetail" @click="goToApprovalDetail">
            查看审批详情
          </el-button>
          <ContractActions
            :detail="detail"
            :capabilities="capabilities"
            :wecom-users="wecomUsers"
            @refresh="silentRefresh"
          />
        </template>
        <template v-if="detail" #extra>
          <ContractProgress :detail="detail" />
        </template>
      </FinanceDetailHeader>

      <el-alert
        v-if="stopNotice"
        :type="stopNoticeAlertType(stopNotice.kind)"
        :closable="false"
        show-icon
        :title="stopNotice.title"
      >
        <span v-if="stopNotice.by">{{ stopNotice.by }}：</span
        >{{ stopNotice.comment }}
        <time v-if="stopNotice.at" class="contract-detail-panel__notice-time">
          {{ formatBeijingDateTime(stopNotice.at) }}
        </time>
      </el-alert>

      <FinPanels v-if="detail || isCreate">
        <AiVerdictPanel
          v-if="detail && aiVisible && !isEditing"
          :reviews="aiGateReviews"
          :biz-type="aiBizType"
          :report="NO_REPORT"
          :contract-result="detail.ai_review_result"
          :contract-status="detail.ai_review_status"
        />

        <ContractInfoSection
          v-model:editing="editing"
          v-model:super-edit-mode="superEditMode"
          v-model:super-edit-note="superEditNote"
          :detail="detail"
          :is-create="isCreate"
          :initial-direction="initialDirection"
          :capabilities="capabilities"
          :wecom-users="wecomUsers"
          :to-user-label="toUserLabel"
          :draft-attachments-json="draftAttachmentsJson"
          @refresh="silentRefresh"
          @created="id => emit('created', id)"
        />

        <template v-if="detail && !isEditing">
          <ContractInboundRecords
            v-if="detail.direction === 'inbound'"
            :detail="detail"
            @refresh="silentRefresh"
            @nav="emit('nav')"
          />
          <ContractPayments
            v-else
            :rows="detail.payment_requests"
            @refresh="silentRefresh"
          />

          <ContractAmountChanges
            :contract-id="detail.id"
            :rows="detail.amount_changes"
            :roles="roles"
            :to-user-label="toUserLabel"
            @refresh="silentRefresh"
            @nav="emit('nav')"
          />
        </template>

        <BizAttachments
          :items="attachmentItems"
          category="contract"
          :upload-via="uploadVia"
          :can-remove="canRemoveAttachment"
          :instance-id="detail?.approval_instance_id"
          :persist="persistAttachments"
          :blocked-reason="attachmentBlockedReason"
          @refresh="silentRefresh"
        />

        <template v-if="detail && !isEditing">
          <FlowTimeline
            v-if="approvalDetail"
            :nodes="approvalDetail.nodes"
            :tasks="approvalDetail.tasks"
            :current-node-key="approvalDetail.instance.current_node_key"
            :current-round="approvalDetail.instance.current_round"
            :instance-status="approvalDetail.instance.status"
            :is-super-admin="false"
            :to-user-label="toUserLabel"
          />
          <FinSection v-else-if="detail.approval_instance_id" title="审批流程">
            <p class="contract-detail-panel__note">
              暂时看不到审批流程：可能没有查看权限，或者网络中断。
            </p>
          </FinSection>
        </template>
      </FinPanels>
    </template>
  </div>
</template>

<style scoped>
.contract-detail-panel {
  min-height: 240px;
}

.contract-detail-panel__title {
  flex-basis: 100%;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  color: #3f3527;
  word-break: break-word;
}

.contract-detail-panel__waiting {
  font-size: 13px;
  color: #8c6a2f;
}

.contract-detail-panel__note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #6e6458;
}

.contract-detail-panel__notice-time {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.create-masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: linear-gradient(180deg, #fffdf7 0%, #f9f1e0 100%);
  border: 1px solid #e3d5b8;
  border-radius: 10px;
}

.create-masthead__title {
  font-size: 16px;
  font-weight: 700;
  color: #3f3527;
}
</style>
