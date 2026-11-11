import { http } from "@/utils/http";

import type {
  ApiResult,
  DeviceDetail,
  DeviceImportRow,
  DeviceRow,
  DeviceState,
  ImportResult,
  PagedResult,
  WhDocResult
} from "./types";

const base = "/api/v1/warehouse/device";

export interface DeviceQuery {
  state?: DeviceState;
  category_id?: number;
  project_id?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export type DeviceInput = Partial<
  Pick<
    DeviceRow,
    | "device_code"
    | "name"
    | "alias"
    | "category_id"
    | "machine_type"
    | "diameter_mm"
    | "manufacturer"
    | "model"
    | "serial_no"
    | "spec"
    | "ownership"
    | "purchased_date"
    | "storage_note"
    | "photo_key"
    | "remark"
  >
>;

export const listDevices = (params: DeviceQuery = {}) =>
  http.request<PagedResult<DeviceRow>>("get", base, { params });
export const getDevice = (id: number) =>
  http.request<ApiResult<DeviceDetail>>("get", `${base}/${id}`);
export const getDeviceByCode = (code: string) =>
  http.request<ApiResult<DeviceRow>>(
    "get",
    `${base}/by-code/${encodeURIComponent(code)}`
  );
export const createDevice = (data: DeviceInput) =>
  http.request<ApiResult<{ id: number; device_code: string }>>("post", base, {
    data
  });
export const updateDevice = (id: number, data: DeviceInput) =>
  http.request<{ success: boolean }>("put", `${base}/${id}`, { data });
export const importDevices = (data: {
  client_request_id: string;
  rows: DeviceImportRow[];
}) => http.request<ApiResult<ImportResult>>("post", `${base}/import`, { data });
export const addDeviceNote = (id: number, summary: string) =>
  http.request<{ success: boolean }>("post", `${base}/${id}/note`, {
    data: { summary }
  });
export const scrapDevice = (
  id: number,
  data: { client_request_id: string; remark: string; photo_keys: string[] }
) =>
  http.request<ApiResult<WhDocResult>>("post", `${base}/${id}/scrap`, { data });
export const unscrapDevice = (
  id: number,
  data: { client_request_id: string; remark?: string }
) =>
  http.request<ApiResult<WhDocResult>>("post", `${base}/${id}/unscrap`, {
    data
  });
