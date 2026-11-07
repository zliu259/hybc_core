<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { message } from "@/utils/message";
import SplitEnvelopeDialog from "./components/SplitEnvelopeDialog.vue";
import ActionDialogs from "./detail/ActionDialogs.vue";
import AttachmentPicker from "./detail/AttachmentPicker.vue";
import AttachmentViewer from "./detail/AttachmentViewer.vue";
import EnvelopeInfoPanel from "./detail/EnvelopeInfoPanel.vue";
import MoreActionsMenu from "./detail/MoreActionsMenu.vue";
import TotalsBar from "./detail/TotalsBar.vue";
import VerdictHeader from "./detail/VerdictHeader.vue";
import { useAttachmentActions } from "./detail/useAttachmentActions";
import { useDetailCommands } from "./detail/useDetailCommands";
import { useEnvelopeActions } from "./detail/useEnvelopeActions";
import { useEnvelopeDetail } from "./detail/useEnvelopeDetail";
import { useEnvelopePermissions } from "./detail/useEnvelopePermissions";
import { useEnvelopeSummary } from "./detail/useEnvelopeSummary";
import { useEnvelopeUploads } from "./detail/useEnvelopeUploads";
import {
  defaultSelection,
  resolveGuidance,
  type PickerSelection
} from "./detail/view-model";

defineOptions({ name: "ReimbursementDetail" });

// 布尔 prop 不传时 Vue 会给 false，这里要明确成 undefined，否则工作台路由判断永远走不到
const props = withDefaults(
  defineProps<{
    envelopeId?: number | string;
    drawerMode?: boolean;
    workspaceView?: boolean;
  }>(),
  { envelopeId: undefined, workspaceView: undefined }
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "changed"): void;
  (event: "created", id: number): void;
}>();

const route = useRoute();
const router = useRouter();
const isWorkspaceView = computed(
  () => props.workspaceView ?? route.path.startsWith("/workspace/")
);

// 第一个文件传完时才建草稿，建好之后这里记住，抽屉里父组件不会换 envelopeId
const createdEnvelopeId = ref<number | null>(null);
const incomingEnvelopeId = computed(() => props.envelopeId ?? route.params.id);
const effectiveEnvelopeId = computed(
  () => createdEnvelopeId.value ?? incomingEnvelopeId.value
);
const isCreate = computed(() => effectiveEnvelopeId.value === "create");
const resolvedEnvelopeId = computed(() => Number(effectiveEnvelopeId.value));

const {
  detail,
  form,
  loading,
  dirty,
  amountTouched,
  pollingPaused,
  load,
  patchForm
} = useEnvelopeDetail({
  envelopeId: resolvedEnvelopeId,
  isCreate
});

const baseLoading = ref(false);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const entities = ref<Entity[]>([]);
const titleEntityId = ref<number | undefined>(undefined);

const notifyChanged = () => emit("changed");

const detailPath = (id: number) =>
  isWorkspaceView.value
    ? `/workspace/my-reimbursement/detail/${id}`
    : `/finance/reimbursement/detail/${id}`;

const permissions = useEnvelopePermissions({
  detail,
  applicantUserid: computed(
    () => detail.value?.applicant_userid || form.value.applicant_userid || ""
  ),
  isCreate,
  isWorkspaceView
});

const actions = useEnvelopeActions({
  detail,
  form,
  amountTouched,
  isCreate,
  envelopeId: resolvedEnvelopeId,
  titleEntityId,
  canEdit: permissions.canEdit,
  isSuperAdmin: permissions.isSuperAdmin,
  isFinanceOrSuperAdmin: permissions.isFinanceOrSuperAdmin,
  load: () => load({ silent: true }),
  loadFresh: () => load({ silent: true, resetForm: true }),
  notifyChanged,
  onCreated: id => {
    createdEnvelopeId.value = id;
    emit("created", id);
    notifyChanged();
    void load({ silent: true, resetForm: true });
    if (!props.drawerMode) router.replace(detailPath(id));
  }
});

const uploads = useEnvelopeUploads({
  ensureEnvelopeId: () =>
    isCreate.value
      ? actions.createDraft()
      : Promise.resolve(resolvedEnvelopeId.value),
  onBound: async () => {
    await load({ silent: true });
    notifyChanged();
  },
  existingFiles: () =>
    (detail.value?.attachment_views ?? []).map(view => ({
      name: view.file_name,
      size: view.file_size
    }))
});

const guidance = computed(() =>
  resolveGuidance(detail.value, {
    workspaceView: isWorkspaceView.value,
    uploadingCount: uploads.items.value.length,
    isCreate: isCreate.value
  })
);

// 工作台是申请人的视角，就算本人有办公室角色也不显示给办公室的提醒
const views = computed(() =>
  (detail.value?.attachment_views ?? []).map(view =>
    isWorkspaceView.value ? { ...view, attention: null } : view
  )
);

const selection = ref<PickerSelection>({ kind: "info" });
const selectedView = computed(() => {
  const current = selection.value;
  if (current.kind !== "attachment") return null;
  return (
    views.value.find(view => view.attachment_id === current.attachmentId) ??
    null
  );
});

const applyDefaultSelection = () => {
  const usingOfficeGuidance =
    !isWorkspaceView.value && Boolean(detail.value?.guidance?.office);
  const isEditableDraft =
    isCreate.value ||
    ["draft", "unregistered"].includes(detail.value?.status ?? "");
  selection.value = defaultSelection(
    views.value,
    usingOfficeGuidance,
    isEditableDraft
  );
};

// 选中的附件被删掉时回到报销信息
watch(views, () => {
  if (selection.value.kind === "attachment" && !selectedView.value)
    selection.value = { kind: "info" };
});

const { facts, displayedTotals } = useEnvelopeSummary({
  detail,
  form,
  canEdit: permissions.canEdit,
  projects,
  users: wecomUsers
});

const attachmentActions = useAttachmentActions({
  detail,
  load: () => load({ silent: true }),
  notifyChanged
});

const dialogs = ref<InstanceType<typeof ActionDialogs> | null>(null);
const splitDialogVisible = ref(false);

const {
  loadingKeys,
  moreItems,
  closeDetail,
  openEnvelope,
  onGuidanceAction,
  onMoreAction,
  onDialogConfirm,
  onFiles
} = useDetailCommands({
  detail,
  views,
  actions,
  attachmentActions,
  permissions,
  uploads,
  isCreate,
  openDialog: kind => dialogs.value?.open(kind),
  openSplit: () => {
    splitDialogVisible.value = true;
  },
  drawerMode: computed(() => Boolean(props.drawerMode)),
  isWorkspaceView,
  detailPath,
  close: () => emit("close")
});

const initializeEnvelope = async () => {
  await load();
  titleEntityId.value = detail.value?.invoice_title_entity_id ?? undefined;
  applyDefaultSelection();
};

onMounted(async () => {
  baseLoading.value = true;
  try {
    // 通讯录或主体加载失败都不能挡住详情，否则页面会一直是空白
    await Promise.allSettled([
      loadProjects(),
      loadWecomUsers(),
      listEntities().then(result => {
        entities.value = result.data;
      })
    ]);
    await initializeEnvelope();
  } finally {
    baseLoading.value = false;
  }
});

// 拆单弹窗里的附件表格换数据会清空勾选，弹窗开着时先停轮询
watch(splitDialogVisible, value => {
  pollingPaused.value = value;
});

watch(incomingEnvelopeId, async (next, previous) => {
  if (next === previous) return;
  // 刚建好草稿时路由换成新 id，是同一张单，不用重置选中
  if (
    createdEnvelopeId.value !== null &&
    Number(next) === createdEnvelopeId.value
  )
    return;
  createdEnvelopeId.value = null;
  await initializeEnvelope();
});

watch(
  () => detail.value?.invoice_title_entity_id,
  value => {
    titleEntityId.value = value ?? undefined;
  }
);

const onSplitDone = async () => {
  await load({ silent: true, resetForm: true });
  notifyChanged();
};
</script>

<template>
  <div
    v-loading="loading || baseLoading"
    element-loading-text="正在加载报销详情…"
    class="rb-detail"
  >
    <div class="rb-card">
      <VerdictHeader
        :guidance="guidance"
        :facts="facts"
        :loading-keys="loadingKeys"
        :busy="actions.busy.value"
        :close-label="props.drawerMode ? '关闭' : '返回'"
        @action="onGuidanceAction"
        @close="closeDetail"
      >
        <template #more>
          <MoreActionsMenu
            :items="moreItems"
            :disabled="actions.busy.value"
            @select="onMoreAction"
          />
        </template>
      </VerdictHeader>

      <div class="rb-review">
        <AttachmentPicker
          :views="views"
          :uploads="uploads.items.value"
          :selection="selection"
          :can-upload="permissions.canUpload.value"
          :can-delete="permissions.canDeleteAttachments.value"
          @select="selection = $event"
          @files="onFiles"
          @retry="uploads.retry"
          @dismiss="uploads.dismiss"
          @remove="attachmentActions.removeAttachment"
        />
        <AttachmentViewer
          v-if="selectedView"
          :view="selectedView"
          :can-rerecognize="permissions.canRerecognize(selectedView)"
          :rerecognizing="attachmentActions.rerecognizing.value"
          @rerecognize="attachmentActions.rerecognize([$event])"
          @open-envelope="openEnvelope"
        />
        <EnvelopeInfoPanel
          v-else
          v-model:title-entity-id="titleEntityId"
          :form="form"
          :detail="detail"
          :is-create="isCreate"
          :can-edit="permissions.canEdit.value"
          :dirty="dirty"
          :saving="actions.saving.value"
          :projects="projects"
          :users="wecomUsers"
          :entities="entities"
          :can-edit-invoice-title="permissions.canEditInvoiceTitle.value"
          :saving-invoice-title="actions.savingInvoiceTitle.value"
          @patch="patchForm"
          @save="actions.save"
          @save-title="actions.saveInvoiceTitle"
          @open-envelope="openEnvelope"
        />
      </div>

      <TotalsBar
        v-if="displayedTotals && displayedTotals.attachment_count > 0"
        :totals="displayedTotals"
      />
    </div>

    <ActionDialogs
      ref="dialogs"
      :busy="actions.busy.value"
      @confirm="onDialogConfirm"
    />
    <SplitEnvelopeDialog
      v-if="detail"
      v-model:visible="splitDialogVisible"
      :detail="detail"
      @done="onSplitDone"
      @open-envelope="openEnvelope"
    />
  </div>
</template>

<style scoped>
.rb-detail {
  min-height: 200px;
  container-type: inline-size;
  font-variant-numeric: tabular-nums;
  color: #1f2329;
}

.rb-card {
  overflow: hidden;
  background: #fff;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
}

.rb-review {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  border-top: 1px solid #e7ebf0;
}

@container (max-width: 860px) {
  .rb-review {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
