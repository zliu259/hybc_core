import { http } from "@/utils/http";

import type {
  ApiResult,
  ImportResult,
  LedgerRow,
  Material,
  MaterialImportRow,
  MaterialKind,
  PagedResult
} from "./types";

const base = "/api/v1/warehouse/material";

export interface MaterialQuery {
  keyword?: string;
  category?: string;
  kind?: MaterialKind;
  status?: "active" | "disabled";
  low_stock?: "1";
  page?: number;
  pageSize?: number;
}

export type MaterialInput = Partial<
  Pick<
    Material,
    | "name"
    | "spec"
    | "unit"
    | "category"
    | "kind"
    | "unit_price"
    | "min_stock"
    | "storage_note"
    | "remark"
    | "status"
  >
>;

export const listMaterials = (params: MaterialQuery = {}) =>
  http.request<PagedResult<Material>>("get", base, { params });
export const getMaterial = (id: number) =>
  http.request<ApiResult<Material>>("get", `${base}/${id}`);
export const createMaterial = (data: MaterialInput) =>
  http.request<ApiResult<{ id: number; material_code: string }>>("post", base, {
    data
  });
export const updateMaterial = (id: number, data: MaterialInput) =>
  http.request<{ success: boolean }>("put", `${base}/${id}`, { data });
export const importMaterials = (data: {
  client_request_id: string;
  rows: MaterialImportRow[];
}) => http.request<ApiResult<ImportResult>>("post", `${base}/import`, { data });
export const getMaterialLedger = (
  id: number,
  params: { page?: number; pageSize?: number } = {}
) =>
  http.request<PagedResult<LedgerRow>>("get", `${base}/${id}/ledger`, {
    params
  });
