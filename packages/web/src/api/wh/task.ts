import { http } from "@/utils/http";

import type {
  ApiResult,
  PagedResult,
  TaskDetail,
  TaskKind,
  TaskRow,
  TaskStatus,
  TaskSystem
} from "./types";

const base = "/api/v1/warehouse/task";

export interface TaskQuery {
  scope?: "mine" | "all";
  status?: TaskStatus;
  /** 待派工 no / 已派工 yes，只在 status=todo 时有意义 */
  assigned?: "yes" | "no";
  kind?: TaskKind;
  device_id?: number;
  page?: number;
  pageSize?: number;
}

export interface CreateTaskInput {
  kind: TaskKind;
  title: string;
  description?: string;
  device_id?: number | null;
  blocking?: boolean;
  required_photo_count?: number;
  due_date?: string | null;
  assignee_userid?: string | null;
}

export interface SubmitTaskInput {
  version: number;
  result_note: string;
  result?: "pass" | "fail";
  systems?: TaskSystem[];
}

export const listTasks = (params: TaskQuery = {}) =>
  http.request<PagedResult<TaskRow>>("get", base, { params });
export const getTask = (id: number) =>
  http.request<ApiResult<TaskDetail>>("get", `${base}/${id}`);
export const createTask = (data: CreateTaskInput) =>
  http.request<ApiResult<{ id: number; task_no: string }>>("post", base, {
    data
  });
export const assignTask = (
  id: number,
  data: { version: number; assignee_userid: string | null }
) =>
  http.request<{ success: boolean }>("post", `${base}/${id}/assign`, { data });
export const addTaskPhoto = (id: number, fileKey: string) =>
  http.request<ApiResult<{ id: number }>>("post", `${base}/${id}/photo`, {
    data: { file_key: fileKey }
  });
export const removeTaskPhoto = (id: number, photoId: number) =>
  http.request<{ success: boolean }>(
    "delete",
    `${base}/${id}/photo/${photoId}`
  );
export const submitTask = (id: number, data: SubmitTaskInput) =>
  http.request<
    ApiResult<{ status: "submitted" | "done"; followup_task_id: number | null }>
  >("post", `${base}/${id}/submit`, {
    data
  });
export const confirmTask = (id: number, version: number) =>
  http.request<ApiResult<{ followup_task_id: number | null }>>(
    "post",
    `${base}/${id}/confirm`,
    { data: { version } }
  );
export const sendBackTask = (
  id: number,
  data: { version: number; review_note: string }
) =>
  http.request<{ success: boolean }>("post", `${base}/${id}/send-back`, {
    data
  });
export const cancelTask = (
  id: number,
  data: { version: number; reason: string }
) =>
  http.request<{ success: boolean }>("post", `${base}/${id}/cancel`, { data });
