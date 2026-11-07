import { computed, type ComputedRef, type Ref } from "vue";
import { useRouter } from "vue-router";

import type {
  AttachmentReviewView,
  GuidanceActionKey,
  ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import { message } from "@/utils/message";
import type { useAttachmentActions } from "./useAttachmentActions";
import type { useEnvelopeActions } from "./useEnvelopeActions";
import type { useEnvelopePermissions } from "./useEnvelopePermissions";
import type { ActionDialogKind, MoreActionKey } from "./view-model";

// 把结论区的按钮、「更多」菜单和弹窗确认接到具体操作上。

export const useDetailCommands = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  views: ComputedRef<AttachmentReviewView[]>;
  actions: ReturnType<typeof useEnvelopeActions>;
  attachmentActions: ReturnType<typeof useAttachmentActions>;
  permissions: ReturnType<typeof useEnvelopePermissions>;
  openDialog: (kind: ActionDialogKind) => void;
  openSplit: () => void;
  drawerMode: ComputedRef<boolean>;
  isWorkspaceView: ComputedRef<boolean>;
  detailPath: (id: number) => string;
  close: () => void;
}) => {
  const { actions, attachmentActions, permissions, openDialog } = deps;
  const router = useRouter();

  const leaveTo = (path: string) => {
    if (deps.drawerMode.value) deps.close();
    router.push(path);
  };

  const closeDetail = () => {
    if (deps.drawerMode.value) {
      deps.close();
      return;
    }
    router.push(
      deps.isWorkspaceView.value
        ? "/workspace/my-reimbursement"
        : "/finance/reimbursement"
    );
  };

  const openEnvelope = (id: number) => leaveTo(deps.detailPath(id));

  const showBatch = () => {
    const batch = deps.detail.value?.batch;
    if (!batch) return;
    if (permissions.canSeeOfficeReview.value) {
      leaveTo(`/finance/reimbursement/batch/${batch.id}`);
      return;
    }
    message(`所在批次：${batch.batch_no}`, { type: "info" });
  };

  const loadingKeys = computed<GuidanceActionKey[]>(() => {
    const keys: [GuidanceActionKey, boolean][] = [
      ["verify", actions.verifyingAction.value === "verified"],
      ["mark_mismatch", actions.verifyingAction.value === "mismatch"],
      ["precheck_approve", actions.precheckAction.value === "approved"],
      ["precheck_supplement", actions.precheckAction.value === "supplement"],
      ["precheck_reject", actions.precheckAction.value === "rejected"],
      ["submit", actions.submitting.value],
      ["resubmit", actions.submitting.value],
      ["rerecognize_failed", attachmentActions.rerecognizing.value],
      ["scan_register", actions.scanningEnvelope.value]
    ];
    return keys.filter(([, active]) => active).map(([key]) => key);
  });

  const moreItems = computed(() => {
    const items: { key: MoreActionKey; label: string; danger?: boolean }[] = [];
    if (permissions.canRebindUuid.value)
      items.push({ key: "rebind", label: "换绑信封" });
    if (permissions.canSwitchChannel.value)
      items.push({ key: "switch_channel", label: "切换通道" });
    if (permissions.canSplit.value) items.push({ key: "split", label: "拆单" });
    if (permissions.canRerunAll.value)
      items.push({ key: "rerun_all", label: "全部重新识别" });
    if (permissions.canVoid.value)
      items.push({ key: "void", label: "废止", danger: true });
    return items;
  });

  const onGuidanceAction = (key: GuidanceActionKey) => {
    const handlers: Record<GuidanceActionKey, () => unknown> = {
      verify: () => openDialog("verify"),
      mark_mismatch: () => openDialog("mark_mismatch"),
      precheck_approve: () => actions.submitPrecheck("approved"),
      precheck_supplement: () => openDialog("precheck_supplement"),
      precheck_reject: () => openDialog("precheck_reject"),
      submit: actions.submitEnvelope,
      resubmit: actions.submitEnvelope,
      rerecognize_failed: () =>
        attachmentActions.rerecognize(
          deps.views.value
            .filter(permissions.canRerecognize)
            .map(view => view.attachment_id)
        ),
      scan_register: actions.scanSubmit,
      view_batch: showBatch,
      open_batching: () => leaveTo("/finance/reimbursement/batch")
    };
    void handlers[key]();
  };

  const onMoreAction = (key: MoreActionKey) => {
    const handlers: Record<MoreActionKey, () => unknown> = {
      rebind: () => openDialog("rebind"),
      switch_channel: actions.onSwitchChannel,
      split: deps.openSplit,
      rerun_all: () => openDialog("rerun_all"),
      void: () => openDialog("void")
    };
    void handlers[key]();
  };

  const onDialogConfirm = (payload: {
    kind: ActionDialogKind;
    value: string;
    uuid: string;
  }) => {
    const handlers: Record<ActionDialogKind, () => unknown> = {
      verify: () => actions.verify("verified", payload.value),
      mark_mismatch: () => actions.verify("mismatch", payload.value),
      precheck_supplement: () =>
        actions.submitPrecheck("supplement", payload.value),
      precheck_reject: () => actions.submitPrecheck("rejected", payload.value),
      void: () => actions.voidEnvelope(payload.value),
      rebind: () =>
        actions.submitRebindEnvelopeUuid(payload.uuid, payload.value),
      rerun_all: actions.rerunAll
    };
    void handlers[payload.kind]();
  };

  return {
    loadingKeys,
    moreItems,
    closeDetail,
    openEnvelope,
    onGuidanceAction,
    onMoreAction,
    onDialogConfirm
  };
};
