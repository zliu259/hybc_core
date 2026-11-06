<script setup lang="ts">
/** 附件区：列表、预览沿用审批详情的组件；这里只决定往哪写、能不能删。 */
import type { UploadRequestOptions } from "element-plus";
import { computed, ref } from "vue";
import { uploadApprovalAttachment } from "@/api/approval";
import { updatePaymentRequest, type PaymentRequestDetail } from "@/api/payment";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatToken, getToken } from "@/utils/auth";
import { message } from "@/utils/message";
import AttachmentPanel from "@/views/approval/detail/components/AttachmentPanel.vue";
import AttachmentPreviewDrawer from "@/views/approval/detail/components/AttachmentPreviewDrawer.vue";
import { parseAttachments } from "@/views/approval/detail/formatters";
import type { AttachmentItem } from "@/views/approval/detail/types";
import { useAttachmentPreview } from "@/views/approval/detail/useAttachmentPreview";
import type { AttachmentUploadRoute } from "../payment-detail-view";

defineOptions({ name: "PaymentAttachments" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  uploadVia: AttachmentUploadRoute;
  canRemove: boolean;
  superEditMode: boolean;
  superEditNote: string;
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";

const preview = useAttachmentPreview();
const uploading = ref(false);
const items = computed(() =>
  parseAttachments(props.detail?.attachments_json ?? null)
);

const superEditNoteMissing = () => {
  if (props.superEditMode && !props.superEditNote.trim()) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return true;
  }
  return false;
};

const saveToPayment = async (next: AttachmentItem[]) => {
  const id = props.detail?.id;
  if (!id) throw new Error("付款详情未加载");
  await updatePaymentRequest(id, {
    attachments_json: JSON.stringify(
      next.map(item => ({
        file_key: item.file_key,
        file_name: item.file_name,
        file_size: item.file_size ?? undefined
      }))
    ),
    ...(props.superEditMode
      ? { admin_edit_mode: true, edit_note: props.superEditNote.trim() }
      : {})
  });
};

const putFile = async (file: File): Promise<string> => {
  const signRes = await createUploadSignature({
    fileName: file.name,
    contentType: file.type,
    category: "payment"
  });
  const response = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
    method: "PUT",
    headers: {
      "content-type": file.type || "application/octet-stream",
      Authorization: formatToken(getToken().accessToken)
    },
    body: file
  });
  if (!response.ok) throw new Error(`upload_failed_${response.status}`);
  return signRes.data.key;
};

const upload = async (options: UploadRequestOptions) => {
  const file = options.file;
  const instanceId = props.detail?.approval_instance_id;
  if (superEditNoteMissing()) {
    options.onError?.(new Error("edit_note_required") as never);
    return;
  }
  uploading.value = true;
  try {
    const key = await putFile(file);
    const item = { file_key: key, file_name: file.name, file_size: file.size };
    if (props.uploadVia === "approval" && instanceId) {
      await uploadApprovalAttachment(instanceId, item);
    } else {
      await saveToPayment([item, ...items.value]);
    }
    message(`已上传 ${file.name}`, { type: "success" });
    options.onSuccess?.({});
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "附件上传失败，请重试"), {
      type: "error"
    });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploading.value = false;
  }
};

const remove = async (target: AttachmentItem) => {
  if (superEditNoteMissing()) return;
  try {
    await saveToPayment(
      items.value.filter(item => item.file_key !== target.file_key)
    );
    message(`已移除 ${target.file_name}`, { type: "success" });
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "移除附件失败，请重试"), {
      type: "error"
    });
  }
};
</script>

<template>
  <AttachmentPanel
    :items="items"
    :can-upload="uploadVia !== null"
    :can-remove="canRemove"
    :uploading="uploading"
    :upload="upload"
    :accept="ACCEPT"
    empty-text="还没有附件"
    @preview="item => preview.open(items, item)"
    @download="item => preview.download(item.file_key)"
    @remove="remove"
  />
  <AttachmentPreviewDrawer
    v-model:visible="preview.visible.value"
    :url="preview.url.value"
    :file-name="preview.fileName.value"
    :index="preview.index.value"
    :total="preview.list.value.length"
    @step="preview.step"
  />
</template>
