import { http } from "@/utils/http";

import type {
  KitFulfilmentLine,
  KitLineInput,
  KitPlanParams,
  KitPlanPreview,
  KitPlanSource,
  KitPlanSources,
  KitTemplateDetail,
  KitTemplateRow,
  ProjectKitDetail,
  ProjectKitRow,
  ProjectKitStatus,
  ProjectLedger,
  TemplateLineInput
} from "./kit-types";
import type { ApiResult, PagedResult } from "./types";

const base = "/api/v1/warehouse";

// ─── 模板 ──────────
export const listKitTemplates = (
  params: { status?: "active" | "disabled" } = {}
) =>
  http.request<ApiResult<KitTemplateRow[]>>("get", `${base}/kit-template`, {
    params
  });
export const getKitTemplate = (id: number) =>
  http.request<ApiResult<KitTemplateDetail>>(
    "get",
    `${base}/kit-template/${id}`
  );
export const createKitTemplate = (data: {
  name: string;
  machine_type?: string | null;
  diameter_mm?: number | null;
  remark?: string | null;
  lines?: TemplateLineInput[];
}) =>
  http.request<ApiResult<{ id: number }>>("post", `${base}/kit-template`, {
    data
  });
export const updateKitTemplate = (
  id: number,
  data: {
    version: number;
    name?: string;
    machine_type?: string | null;
    diameter_mm?: number | null;
    remark?: string | null;
    status?: "active" | "disabled";
    lines?: TemplateLineInput[];
  }
) =>
  http.request<{ success: boolean }>("put", `${base}/kit-template/${id}`, {
    data
  });

// ─── 项目清单 ──────────
export interface KitQuery {
  project_id?: number;
  status?: ProjectKitStatus;
  keyword?: string;
  page?: number;
  pageSize?: number;
}
export const listKits = (params: KitQuery = {}) =>
  http.request<PagedResult<ProjectKitRow>>("get", `${base}/kit`, { params });
export const getKit = (id: number) =>
  http.request<ApiResult<ProjectKitDetail>>("get", `${base}/kit/${id}`);
export const createKit = (data: {
  project_id: number;
  title: string;
  remark?: string | null;
  template_id?: number | null;
  copy_from_kit_id?: number | null;
  lines?: KitLineInput[];
  /** 按项目参数生成：要和 template_id 一起给，行由服务端算 */
  plan?: { params: KitPlanParams; sources: KitPlanSources };
}) =>
  http.request<ApiResult<{ id: number; kit_no: string }>>(
    "post",
    `${base}/kit`,
    { data }
  );

// ─── 按项目参数生成 ──────────
/** 从工作段和项目档案取到的参数。 */
export const getKitPlanSource = (projectId: number) =>
  http.request<ApiResult<KitPlanSource>>("get", `${base}/kit/plan/source`, {
    params: { project_id: projectId }
  });
/** 预览：算好的行、主要设备的候选、提醒。不写库。 */
export const previewKitPlan = (data: {
  project_id: number;
  template_id: number;
  params: KitPlanParams;
}) =>
  http.request<ApiResult<KitPlanPreview>>("post", `${base}/kit/plan/preview`, {
    data
  });
export const updateKit = (
  id: number,
  data: {
    version: number;
    title?: string;
    remark?: string | null;
    lines?: KitLineInput[];
  }
) => http.request<{ success: boolean }>("put", `${base}/kit/${id}`, { data });
export const submitKit = (id: number, version: number) =>
  http.request<ApiResult<{ status: "submitted" | "confirmed" }>>(
    "post",
    `${base}/kit/${id}/submit`,
    { data: { version } }
  );
export const confirmKit = (id: number, version: number) =>
  http.request<{ success: boolean }>("post", `${base}/kit/${id}/confirm`, {
    data: { version }
  });
export const discardKit = (id: number, version: number, reason: string) =>
  http.request<{ success: boolean }>("post", `${base}/kit/${id}/discard`, {
    data: { version, reason }
  });
export const closeKit = (id: number, version: number) =>
  http.request<{ success: boolean }>("post", `${base}/kit/${id}/close`, {
    data: { version }
  });
export const getKitFulfilment = (id: number) =>
  http.request<ApiResult<KitFulfilmentLine[]>>(
    "get",
    `${base}/kit/${id}/fulfilment`
  );

// ─── 项目物资 ──────────
export const getProjectLedger = (projectId: number) =>
  http.request<ApiResult<ProjectLedger>>(
    "get",
    `${base}/project/${projectId}/ledger`
  );
