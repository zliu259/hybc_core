import { http } from "@/utils/http";

import type {
  ApiResult,
  CreateWhDocInput,
  PagedResult,
  ProjectHoldings,
  WhDocLineRow,
  WhDocResult,
  WhDocRow,
  WhDocType
} from "./types";

const base = "/api/v1/warehouse";

export interface WhDocQuery {
  doc_type?: WhDocType;
  project_id?: number;
  keyword?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  pageSize?: number;
}

export const createWhDoc = (data: CreateWhDocInput) =>
  http.request<ApiResult<WhDocResult>>("post", `${base}/doc`, { data });
export const listWhDocs = (params: WhDocQuery = {}) =>
  http.request<PagedResult<WhDocRow>>("get", `${base}/doc`, { params });
export const getWhDoc = (id: number) =>
  http.request<ApiResult<WhDocRow & { lines: WhDocLineRow[] }>>(
    "get",
    `${base}/doc/${id}`
  );
export const reverseWhDoc = (id: number, clientRequestId: string) =>
  http.request<ApiResult<WhDocResult>>("post", `${base}/doc/${id}/reverse`, {
    data: { client_request_id: clientRequestId }
  });
export const getProjectHoldings = (projectId: number) =>
  http.request<ApiResult<ProjectHoldings>>(
    "get",
    `${base}/project/${projectId}/holdings`
  );
