import { computed, ref, type ComputedRef, type Ref } from "vue";

import { addEnvelopeAttachments } from "@/api/reimbursement";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { formatToken, getToken } from "@/utils/auth";

// 多文件上传。每个文件独立走完「签名、传 R2、绑定」，一个失败不影响其他，失败的单独重试。
// 进度和状态都在这里，轮询刷新详情不会碰到它们。

export type UploadItem = {
  localId: string;
  file: File;
  name: string;
  progress: number;
  status: "waiting" | "uploading" | "failed" | "done";
  error: string | null;
};

const CONCURRENCY = 3;
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const validateFile = (file: File): string | null => {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(extension))
    return `${file.name}：只支持 PDF、JPG、PNG`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}：不能超过 20MB`;
  return null;
};

const errorMessage = (error: unknown): string => {
  const shape = error as {
    response?: {
      data?: { message?: string; error?: string | { message?: string } };
    };
    message?: string;
  };
  const rawError = shape?.response?.data?.error;
  const backend =
    shape?.response?.data?.message ||
    (typeof rawError === "string" ? rawError : rawError?.message);
  if (backend) return backend;
  const message = shape?.message ?? "";
  return /[一-鿿]/.test(message) ? message : "上传失败，请重试";
};

const putFile = (
  url: string,
  file: File,
  onProgress: (percent: number) => void
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader(
      "content-type",
      file.type || "application/octet-stream"
    );
    xhr.setRequestHeader("Authorization", formatToken(getToken().accessToken));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload_failed_${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("upload_network_error"));
    xhr.send(file);
  });

export const useEnvelopeUploads = (options: {
  ensureEnvelopeId: () => Promise<number>;
  onBound: () => Promise<void>;
  /** 页面上已有的附件，文件名和大小都相同的跳过 */
  existingFiles?: () => { name: string | null; size: number | null }[];
}): {
  items: Ref<UploadItem[]>;
  uploadingCount: ComputedRef<number>;
  hasFailed: ComputedRef<boolean>;
  addFiles: (files: File[]) => {
    skipped: string[];
    rejected: { name: string; message: string }[];
  };
  retry: (localId: string) => void;
  dismiss: (localId: string) => void;
} => {
  const items = ref<UploadItem[]>([]) as Ref<UploadItem[]>;
  let sequence = 0;
  let creatingEnvelope: Promise<number> | null = null;
  const uploadedKeys = new Map<string, string>();

  const uploadingCount = computed(
    () =>
      items.value.filter(
        item => item.status === "waiting" || item.status === "uploading"
      ).length
  );
  const hasFailed = computed(() =>
    items.value.some(item => item.status === "failed")
  );

  const patchItem = (localId: string, patch: Partial<UploadItem>) => {
    items.value = items.value.map(item =>
      item.localId === localId ? { ...item, ...patch } : item
    );
  };

  const removeItem = (localId: string) => {
    items.value = items.value.filter(item => item.localId !== localId);
  };

  /** 多个文件同时走到这里也只建一个草稿。失败后下一次重试会再建。 */
  const ensureEnvelopeOnce = (): Promise<number> => {
    if (creatingEnvelope) return creatingEnvelope;
    const pending = options.ensureEnvelopeId().finally(() => {
      creatingEnvelope = null;
    });
    creatingEnvelope = pending;
    return pending;
  };

  /**
   * 传过的文件重试时不再传：沿用同一个 key，接口看到相同 file_key 会返回已有记录。
   * 否则绑定成功但响应丢了的文件，重试会多绑一份。
   */
  const uploadOnce = async (item: UploadItem): Promise<string> => {
    const existing = uploadedKeys.get(item.localId);
    if (existing) return existing;
    const sign = await createUploadSignature({
      fileName: item.file.name,
      contentType: item.file.type,
      category: "reimbursement"
    });
    await putFile(resolveUploadUrl(sign.data.uploadUrl), item.file, progress =>
      patchItem(item.localId, { progress })
    );
    uploadedKeys.set(item.localId, sign.data.key);
    return sign.data.key;
  };

  const runItem = async (item: UploadItem) => {
    try {
      const fileKey = await uploadOnce(item);
      const envelopeId = await ensureEnvelopeOnce();
      await addEnvelopeAttachments(envelopeId, [
        {
          file_key: fileKey,
          file_name: item.file.name,
          file_size: item.file.size
        }
      ]);
      uploadedKeys.delete(item.localId);
      removeItem(item.localId);
    } catch (error) {
      patchItem(item.localId, {
        status: "failed",
        error: errorMessage(error),
        progress: 0
      });
      pump();
      return;
    }
    pump();
    try {
      await options.onBound();
    } catch (error) {
      // 文件已经绑定好，刷新失败下一次轮询会补上
      console.error("reimbursement detail refresh failed", error);
    }
  };

  const pump = () => {
    const running = items.value.filter(
      item => item.status === "uploading"
    ).length;
    const next = items.value
      .filter(item => item.status === "waiting")
      .slice(0, Math.max(CONCURRENCY - running, 0));
    next.forEach(item => {
      patchItem(item.localId, {
        status: "uploading",
        error: null,
        progress: 0
      });
      void runItem(item);
    });
  };

  const addFiles = (files: File[]) => {
    const skipped: string[] = [];
    const rejected: { name: string; message: string }[] = [];
    const existing = options.existingFiles?.() ?? [];
    files.forEach(file => {
      const message = validateFile(file);
      if (message) {
        rejected.push({ name: file.name, message });
        return;
      }
      const isSame = (candidate: {
        name: string | null;
        size: number | null;
      }) => candidate.name === file.name && candidate.size === file.size;
      const queued = items.value.some(
        item =>
          item.status !== "failed" &&
          isSame({ name: item.name, size: item.file.size })
      );
      if (queued || existing.some(isSame)) {
        skipped.push(file.name);
        return;
      }
      sequence += 1;
      items.value = [
        ...items.value.filter(
          item =>
            !(
              item.status === "failed" &&
              isSame({ name: item.name, size: item.file.size })
            )
        ),
        {
          localId: `u${sequence}`,
          file,
          name: file.name,
          progress: 0,
          status: "waiting",
          error: null
        }
      ];
    });
    pump();
    return { skipped, rejected };
  };

  const retry = (localId: string) => {
    const target = items.value.find(item => item.localId === localId);
    if (!target || target.status !== "failed") return;
    patchItem(localId, { status: "waiting", error: null, progress: 0 });
    pump();
  };

  return {
    items,
    uploadingCount,
    hasFailed,
    addFiles,
    retry,
    dismiss: removeItem
  };
};
