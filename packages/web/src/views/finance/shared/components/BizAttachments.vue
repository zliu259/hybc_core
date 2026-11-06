<script setup lang="ts">
/**
 * 付款单、合同共用的附件区：列表和预览沿用审批详情的组件，这里只管上传流程。
 * 写到哪由调用方决定：审批进行中业务接口不接受写入，要走审批接口。
 */
import type { UploadRequestOptions } from "element-plus";
import { ref } from "vue";
import { uploadApprovalAttachment } from "@/api/approval";
import { uploadAttachmentFile } from "@/api/upload";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import AttachmentPanel from "@/views/approval/detail/components/AttachmentPanel.vue";
import AttachmentPreviewDrawer from "@/views/approval/detail/components/AttachmentPreviewDrawer.vue";
import type { AttachmentItem } from "@/views/approval/detail/types";
import { useAttachmentPreview } from "@/views/approval/detail/useAttachmentPreview";
import type { AttachmentUploadRoute } from "../format";

defineOptions({ name: "BizAttachments" });

const props = defineProps<{
  items: AttachmentItem[];
  /** R2 存放目录，如 payment、contract */
  category: string;
  uploadVia: AttachmentUploadRoute;
  canRemove: boolean;
  /** uploadVia 为 approval 时写入的审批实例 */
  instanceId?: number | null;
  /** 把新的附件列表写回业务单 */
  persist: (next: AttachmentItem[]) => Promise<void>;
  /** 非空时不允许写入并提示这句话；要在传文件之前拦，否则会留下孤儿文件 */
  blockedReason?: string;
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";

const preview = useAttachmentPreview();
const uploading = ref(false);

const blocked = (): boolean => {
  if (!props.blockedReason) return false;
  message(props.blockedReason, { type: "warning" });
  return true;
};

const upload = async (options: UploadRequestOptions) => {
  const file = options.file;
  if (blocked()) {
    options.onError?.(new Error("upload_blocked") as never);
    return;
  }
  uploading.value = true;
  try {
    const item = await uploadAttachmentFile(file, props.category);
    if (props.uploadVia === "approval" && props.instanceId) {
      await uploadApprovalAttachment(props.instanceId, {
        file_key: item.file_key,
        file_name: item.file_name,
        file_size: item.file_size ?? undefined
      });
    } else {
      await props.persist([item, ...props.items]);
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
  if (blocked()) return;
  try {
    await props.persist(
      props.items.filter(item => item.file_key !== target.file_key)
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
