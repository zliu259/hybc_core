import { computed, ref } from "vue";
import { resolveUploadUrl, signDownloadUrl } from "@/api/upload";
import type { AttachmentItem } from "./types";

// legacy/fin 等受保护前缀需带签名访问；签名失败回退直连，避免整块附件不可用
const signedFileUrl = async (fileKey: string): Promise<string> => {
  try {
    const res = await signDownloadUrl(fileKey);
    return resolveUploadUrl(res.data.url);
  } catch {
    return resolveUploadUrl(
      `/api/v1/upload/object/${encodeURIComponent(fileKey)}`
    );
  }
};

export function useAttachmentPreview() {
  const visible = ref(false);
  const url = ref("");
  const list = ref<AttachmentItem[]>([]);
  const index = ref(0);
  const fileName = computed(() => list.value[index.value]?.file_name ?? "");

  const showAt = async (target: number) => {
    const item = list.value[target];
    if (!item) return;
    index.value = target;
    url.value = await signedFileUrl(item.file_key);
    visible.value = true;
  };

  const open = (items: AttachmentItem[], item: AttachmentItem) => {
    list.value = items;
    return showAt(
      Math.max(
        items.findIndex(row => row.file_key === item.file_key),
        0
      )
    );
  };

  const step = (delta: number) => showAt(index.value + delta);

  const download = async (fileKey: string) => {
    window.open(await signedFileUrl(fileKey), "_blank");
  };

  return { visible, url, list, index, fileName, open, step, download };
}
