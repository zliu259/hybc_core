import { computed, type ComputedRef, type Ref } from "vue";

import type { ReimbursementEnvelopeDetail } from "@/api/reimbursement";
import { useUserStoreHook } from "@/store/modules/user";
import type { AttachmentReviewView } from "@/api/reimbursement";

// 页面上按钮显不显示的判断，口径和接口一致。接口的权限检查才是最终的。

const OFFICE_ROLES = ["super_admin", "manager", "site_manager", "finance"];
const EDITABLE_STATUSES = new Set(["draft", "submitted"]);
const PRE_SUBMIT_STATUSES = new Set(["draft", "unregistered"]);
// 与后端 attachment-delete.ts 的 OFFICE_DELETABLE_STATUSES 一致
const OFFICE_DELETE_STATUSES = new Set(["submitted", "received"]);
const TITLE_LOCKED_STATUSES = new Set([
  "batched",
  "pending_approval",
  "approved",
  "paid",
  "cancelled",
  "deleted"
]);
// 与后端 reimbursement-channel-switch-policy.ts 的 switchableChannelStatuses 一致
const SWITCHABLE_CHANNEL_STATUSES = new Set([
  "draft",
  "unregistered",
  "submitted"
]);
const VOIDABLE_STATUSES = new Set([
  "draft",
  "submitted",
  "received",
  "unregistered"
]);

export const useEnvelopePermissions = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  applicantUserid: ComputedRef<string>;
  isCreate: ComputedRef<boolean>;
  isWorkspaceView: ComputedRef<boolean>;
}) => {
  const { detail, applicantUserid, isCreate, isWorkspaceView } = deps;
  const userStore = useUserStoreHook();
  const roleSet = computed(() => new Set(userStore.roles ?? []));
  const hasOfficeRole = computed(() =>
    OFFICE_ROLES.some(role => roleSet.value.has(role))
  );
  const isSuperAdmin = computed(() => roleSet.value.has("super_admin"));
  const isFinanceOrSuperAdmin = computed(
    () => roleSet.value.has("super_admin") || roleSet.value.has("finance")
  );
  const isApplicant = computed(() => {
    const currentUserId = String(userStore.username || "").trim();
    return Boolean(
      currentUserId && currentUserId === applicantUserid.value.trim()
    );
  });

  const canOfficeAudit = computed(
    () =>
      hasOfficeRole.value && (!isApplicant.value || isFinanceOrSuperAdmin.value)
  );
  const canSeeOfficeReview = computed(
    () => canOfficeAudit.value && !isWorkspaceView.value
  );

  const canEdit = computed(() => {
    if (isCreate.value) return true;
    if (!detail.value) return false;
    if (EDITABLE_STATUSES.has(detail.value.status)) return true;
    return canOfficeAudit.value && detail.value.status === "received";
  });

  const canUpload = computed(
    () =>
      canEdit.value &&
      !detail.value?.batch_id &&
      !detail.value?.approval_instance_id
  );

  const isReturned = computed(
    () =>
      detail.value?.status === "submitted" &&
      ["supplement", "rejected"].includes(detail.value.precheck_status)
  );

  // 提交前和被退回时申请人能删；已提交、已签收还没成批的，办公室能删（比如重复发票）
  const canDeleteAttachments = computed(() => {
    if (!detail.value) return false;
    if (PRE_SUBMIT_STATUSES.has(detail.value.status) || isReturned.value)
      return true;
    return (
      canSeeOfficeReview.value &&
      OFFICE_DELETE_STATUSES.has(detail.value.status) &&
      !detail.value.batch_id &&
      !detail.value.approval_instance_id
    );
  });

  const canRerecognize = (view: AttachmentReviewView): boolean => {
    if (view.state !== "failed" || !detail.value) return false;
    if (detail.value.precheck_status === "approved") return false;
    if (PRE_SUBMIT_STATUSES.has(detail.value.status) || isReturned.value)
      return true;
    return (
      hasOfficeRole.value &&
      ["submitted", "received"].includes(detail.value.status)
    );
  };

  const canSplit = computed(
    () =>
      !isCreate.value &&
      !!detail.value &&
      isFinanceOrSuperAdmin.value &&
      !isWorkspaceView.value &&
      ["submitted", "received"].includes(detail.value.status) &&
      !detail.value.batch_id &&
      !detail.value.approval_instance_id
  );

  const canRebindUuid = computed(() => {
    if (!detail.value || !canSeeOfficeReview.value) return false;
    if (detail.value.channel !== "physical") return false;
    return ["unregistered", "draft", "submitted", "received"].includes(
      detail.value.status
    );
  });

  const canSwitchChannel = computed(
    () =>
      !isCreate.value &&
      !!detail.value &&
      isFinanceOrSuperAdmin.value &&
      SWITCHABLE_CHANNEL_STATUSES.has(detail.value.status)
  );

  const canEditInvoiceTitle = computed(
    () =>
      !isCreate.value &&
      canOfficeAudit.value &&
      !!detail.value &&
      !TITLE_LOCKED_STATUSES.has(detail.value.status)
  );

  const canVoid = computed(
    () =>
      !!detail.value &&
      isSuperAdmin.value &&
      VOIDABLE_STATUSES.has(detail.value.status)
  );

  const canRerunAll = computed(
    () =>
      !!detail.value &&
      canSeeOfficeReview.value &&
      ["submitted", "received"].includes(detail.value.status)
  );

  return {
    canEdit,
    canUpload,
    canOfficeAudit,
    canSeeOfficeReview,
    canDeleteAttachments,
    canRerecognize,
    isSuperAdmin,
    isFinanceOrSuperAdmin,
    canSplit,
    canRebindUuid,
    canSwitchChannel,
    canEditInvoiceTitle,
    canVoid,
    canRerunAll
  };
};
