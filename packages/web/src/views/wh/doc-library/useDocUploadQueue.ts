import { computed, ref, type ComputedRef, type Ref } from "vue";

import {
  abortDocUpload,
  completeDocUpload,
  initDocUpload,
  putDocPart
} from "@/api/wh/doc-library";

import {
  createDocUploadQueue,
  type DocUploadQueue,
  type UploadItemState
} from "./upload-queue";

/** 接上真实接口的上传队列，items 跟着队列变。上传对话框和文件夹导入共用。 */
export const useDocUploadQueue = (): {
  items: Ref<UploadItemState[]>;
  /** 还有排队的或正在传的 */
  busy: ComputedRef<boolean>;
  queue: DocUploadQueue;
  /**
   * 清空清单（打开、关闭对话框时用）：没传完的放弃。
   * 返回这一轮有没有文件开始传过；有的话记录可能已经写成了，调用方要刷新列表。
   */
  reset: () => boolean;
} => {
  const items = ref<UploadItemState[]>([]);
  const queue = createDocUploadQueue({
    init: data => initDocUpload(data).then(result => result.data),
    putPart: putDocPart,
    complete: data => completeDocUpload(data).then(result => result.data),
    abort: token => abortDocUpload(token),
    onChange: next => {
      items.value = next;
    }
  });
  const busy = computed(() =>
    items.value.some(
      item => item.status === "waiting" || item.status === "uploading"
    )
  );
  const reset = () => queue.clearAll();
  return { items, busy, queue, reset };
};
