import { http } from "@/utils/http";

import type {
  CompleteStocktakeResult,
  DeviceMarkInput,
  DeviceMarkResult,
  StocktakeCountInput,
  StocktakeDetail,
  StocktakeMaterialLineRow,
  StocktakeQuery,
  StocktakeRow,
  StocktakeScope
} from "./stocktake-types";
import type { ApiResult, PagedResult } from "./types";

const base = "/api/v1/warehouse/stocktake";

export const listStocktakes = (params: StocktakeQuery = {}) =>
  http.request<PagedResult<StocktakeRow>>("get", base, { params });

export const getStocktake = (id: number) =>
  http.request<ApiResult<StocktakeDetail>>("get", `${base}/${id}`);

export const startStocktake = (data: {
  scope: StocktakeScope;
  remark?: string;
}) => http.request<ApiResult<StocktakeDetail>>("post", base, { data });

export const saveStocktakeCount = (
  id: number,
  lineId: number,
  data: StocktakeCountInput
) =>
  http.request<ApiResult<StocktakeMaterialLineRow>>(
    "put",
    `${base}/${id}/material-line/${lineId}`,
    { data }
  );

export const markStocktakeDevice = (id: number, data: DeviceMarkInput) =>
  http.request<ApiResult<DeviceMarkResult>>(
    "post",
    `${base}/${id}/device-scan`,
    { data }
  );

/** version 是页面看到的盘点版本；和别人的录入撞上时后端返回 409 */
export const completeStocktake = (id: number, version: number) =>
  http.request<ApiResult<CompleteStocktakeResult>>(
    "post",
    `${base}/${id}/complete`,
    { data: { version } }
  );

export const cancelStocktake = (id: number, reason: string) =>
  http.request<ApiResult<StocktakeDetail>>("post", `${base}/${id}/cancel`, {
    data: { reason }
  });
