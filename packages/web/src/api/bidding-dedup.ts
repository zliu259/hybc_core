import { http } from "@/utils/http";
import type { RewriteParagraph } from "@/views/bidding/dedup/lib/rewrite";

export type { RewriteParagraph };

export interface RewriteResultResponse {
  status: "pending" | "assigned" | "running" | "completed" | "failed" | "timeout";
  rewrites?: RewriteParagraph[];
  error?: string;
}

/** POST /bidding/dedup-rewrite — enqueue an AI rewrite task; returns the task_id */
export async function requestRewrite(paragraphs: RewriteParagraph[]): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    "/api/v1/bidding/dedup-rewrite",
    { data: { paragraphs } }
  );
  return res.data.task_id;
}

/** GET /bidding/dedup-rewrite/:taskId — poll for task status and results */
export async function pollRewrite(taskId: number): Promise<RewriteResultResponse> {
  const res = await http.request<{ success: boolean; data: RewriteResultResponse }>(
    "get",
    `/api/v1/bidding/dedup-rewrite/${taskId}`
  );
  return res.data;
}
