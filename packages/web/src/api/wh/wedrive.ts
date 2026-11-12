import { http } from "@/utils/http";

import type { DocMirrorStatus } from "./doc-library-types";
import type { ApiResult } from "./types";

/** 设备资料库的微盘镜像。字段与后端 packages/api/src/services/wedrive/admin.ts 的返回一致。 */
export interface WedriveStatus {
  initialized: boolean;
  enabled: boolean;
  /** 空间有没有对全公司开放 */
  space_open: boolean;
  /** 不为空就是暂停中，值是原因 */
  paused_reason: string | null;
  /** 只数应该在微盘里的资料：没删、是最新版 */
  counts: Record<DocMirrorStatus, number>;
  calls_this_month: number;
  monthly_budget: number;
  mirror_max_mb: number;
}

const base = "/api/v1/doc-library";

export const getWedriveStatus = () =>
  http.request<ApiResult<WedriveStatus>>("get", `${base}/wedrive/status`);
/** 建一个没有成员的空间并打开镜像 */
export const setupWedrive = () =>
  http.request<ApiResult<WedriveStatus>>("post", `${base}/wedrive/setup`);
/** enabled 开关镜像；resume 清掉暂停原因接着做 */
export const saveWedriveSettings = (data: {
  enabled?: boolean;
  resume?: true;
}) =>
  http.request<ApiResult<WedriveStatus>>("put", `${base}/wedrive/settings`, {
    data
  });
export const openWedriveSpace = () =>
  http.request<ApiResult<WedriveStatus>>("post", `${base}/wedrive/open`);
export const retryFailedMirrors = () =>
  http.request<ApiResult<{ requeued: number }>>(
    "post",
    `${base}/wedrive/retry-failed`
  );
/** 把一份资料重新对到微盘 */
export const remirrorDoc = (id: number) =>
  http.request<{ success: boolean }>("post", `${base}/file/${id}/remirror`);
