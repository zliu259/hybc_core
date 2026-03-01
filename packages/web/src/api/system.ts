import { http } from "@/utils/http";

export type OpsServiceHealth = {
  key: string;
  status: "up" | "down";
  checked_at: string;
  detail?: string;
  latency_ms?: number;
};

export type OpsStatusCenterResponse = {
  checked_at: string;
  services: OpsServiceHealth[];
  runner_nodes: {
    online_recent_count: number;
    sampled_total: number;
    latest: Array<{
      node_id: string;
      node_name: string;
      status: string;
      last_heartbeat_at: string | null;
    }>;
  };
};

export const getOpsStatusCenter = () => {
  return http.request<{ success: boolean; data: OpsStatusCenterResponse }>(
    "get",
    "/api/v1/system/ops/status-center"
  );
};
