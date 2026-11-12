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
  /** 清空：没传完的放弃，传完的从清单里拿掉 */
  reset: () => void;
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
  const reset = () => {
    queue.cancelAll();
    queue.clearFinished();
  };
  return { items, busy, queue, reset };
};
