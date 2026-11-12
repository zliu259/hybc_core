import { normalizeApiUrl } from "@/utils/api-url";
import { http } from "@/utils/http";

import type {
  CompleteDocUploadInput,
  DocFileDetail,
  DocFileQuery,
  DocFileRow,
  DocFileUrl,
  DocLibraryConfig,
  DocMetaInput,
  DocShareRow,
  DocTree,
  DocUploadInit,
  DocUploadedPart
} from "./doc-library-types";
import type { ApiResult, PagedResult } from "./types";

/** 设备资料库。库房单（发货、返库）的接口在 ./doc.ts，不是这里。 */
const base = "/api/v1/doc-library";

export const getDocConfig = () =>
  http.request<ApiResult<DocLibraryConfig>>("get", `${base}/config`);
export const listDocFiles = (params: DocFileQuery = {}) =>
  http.request<PagedResult<DocFileRow>>("get", `${base}/file`, { params });
export const getDocFile = (id: number) =>
  http.request<ApiResult<DocFileDetail>>("get", `${base}/file/${id}`);
export const getDocTree = () =>
  http.request<ApiResult<DocTree>>("get", `${base}/tree`);
/** 一台设备适用的资料：它自己的、它的类别的、通用的。taskKind 影响排序。 */
export const listDocsForDevice = (deviceId: number, taskKind?: string) =>
  http.request<ApiResult<DocFileRow[]>>(
    "get",
    `${base}/for-device/${deviceId}`,
    { params: taskKind ? { task_kind: taskKind } : {} }
  );

export const initDocUpload = (data: { file_name: string; file_size: number }) =>
  http.request<ApiResult<DocUploadInit>>("post", `${base}/upload/init`, {
    data
  });

/**
 * 传一片。这个请求不带登录态，靠初始化时拿到的上传令牌；
 * 用 fetch 直接发二进制，不走 axios（不需要重试到备用入口，失败由调用方按片重传）。
 */
export const putDocPart = async (
  token: string,
  partNumber: number,
  blob: Blob,
  signal?: AbortSignal
): Promise<DocUploadedPart> => {
  const url = normalizeApiUrl(
    `${base}/upload/part?token=${encodeURIComponent(token)}&part=${partNumber}`
  );
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: blob,
    signal
  });
  const body: {
    success?: boolean;
    data?: DocUploadedPart;
    error?: { message?: string };
  } | null = await response.json().catch(() => null);
  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.error?.message || `上传失败（${response.status}）`);
  }
  return body.data;
};

export const completeDocUpload = (data: CompleteDocUploadInput) =>
  http.request<ApiResult<{ id: number; replayed: boolean }>>(
    "post",
    `${base}/upload/complete`,
    { data }
  );
export const abortDocUpload = (uploadToken: string) =>
  http.request<{ success: boolean }>("post", `${base}/upload/abort`, {
    data: { upload_token: uploadToken }
  });

export const updateDocFile = (
  id: number,
  data: DocMetaInput & { version: number }
) => http.request<{ success: boolean }>("put", `${base}/file/${id}`, { data });
export const deleteDocFile = (id: number, version: number) =>
  http.request<{ success: boolean }>("delete", `${base}/file/${id}`, {
    data: { version }
  });
/** 15 分钟有效的查看地址。 */
export const getDocFileUrl = (id: number) =>
  http.request<ApiResult<DocFileUrl>>("get", `${base}/file/${id}/url`);

export const createDocShare = (id: number, days?: number) =>
  http.request<ApiResult<DocShareRow>>("post", `${base}/file/${id}/share`, {
    data: days === undefined ? {} : { days }
  });
export const listDocShares = (id: number) =>
  http.request<ApiResult<DocShareRow[]>>("get", `${base}/file/${id}/share`);
export const revokeDocShare = (token: string) =>
  http.request<{ success: boolean }>(
    "delete",
    `${base}/share/${encodeURIComponent(token)}`
  );
