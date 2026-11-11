import { http } from "@/utils/http";

import type {
  ApiResult,
  DeviceCategory,
  WarehouseCapabilities,
  WarehouseMember,
  WarehouseOverview,
  WarehouseSettings
} from "./types";

const base = "/api/v1/warehouse";

export const getWhMe = () =>
  http.request<ApiResult<WarehouseCapabilities>>("get", `${base}/me`);
export const getWhOverview = () =>
  http.request<ApiResult<WarehouseOverview>>("get", `${base}/overview`);
export const getWhSettings = () =>
  http.request<ApiResult<WarehouseSettings>>("get", `${base}/settings`);
export const saveWhSettings = (data: Partial<WarehouseSettings>) =>
  http.request<ApiResult<WarehouseSettings>>("put", `${base}/settings`, {
    data
  });
export const listWhMembers = () =>
  http.request<ApiResult<WarehouseMember[]>>("get", `${base}/member`);
export const addWhMember = (data: {
  userid: string;
  role: WarehouseMember["role"];
}) =>
  http.request<ApiResult<{ userid: string; role: string }>>(
    "post",
    `${base}/member`,
    { data }
  );
export const removeWhMember = (userid: string, role: WarehouseMember["role"]) =>
  http.request<{ success: boolean }>(
    "delete",
    `${base}/member/${encodeURIComponent(userid)}/${role}`
  );
export const listDeviceCategories = () =>
  http.request<ApiResult<DeviceCategory[]>>("get", `${base}/device-category`);
export const createDeviceCategory = (data: {
  name: string;
  sort_order?: number;
}) =>
  http.request<ApiResult<{ id: number }>>("post", `${base}/device-category`, {
    data
  });
export const updateDeviceCategory = (
  id: number,
  data: Partial<Pick<DeviceCategory, "name" | "sort_order" | "status">>
) =>
  http.request<{ success: boolean }>("put", `${base}/device-category/${id}`, {
    data
  });
