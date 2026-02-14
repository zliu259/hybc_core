import { http } from "@/utils/http";

export type TaskQueueItem = {
  id: number;
  task_code: string;
  task_type: string;
  biz_type: string;
  biz_id: number;
  priority: number;
  payload_json: string;
  provider_id: number | null;
  assigned_node_id: string | null;
  status: string;
  max_retries: number;
  retry_count: number;
  timeout_seconds: number;
  result_json: string | null;
  error_message: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ComputeNode = {
  id: number;
  node_id: string;
  node_name: string;
  node_type: string;
  capabilities_json: string | null;
  status: string;
  cpu_cores: number | null;
  memory_mb: number | null;
  last_heartbeat_at: string | null;
  registered_at: string;
  created_at: string;
  updated_at: string;
};

export const listComputeNodes = () => {
  return http.request<{ success: boolean; data: ComputeNode[] }>(
    "get",
    "/api/v1/task/nodes"
  );
};

export const listTaskQueue = (params?: {
  status?: string;
  task_type?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: TaskQueueItem[];
    pagination: { page: number; pageSize: number; total: number };
  }>("get", "/api/v1/task/queue", { params });
};

export const getTaskDetail = (id: number) => {
  return http.request<{ success: boolean; data: TaskQueueItem }>(
    "get",
    `/api/v1/task/${id}`
  );
};
