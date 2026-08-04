import { http } from "@/utils/http";

export type PrecheckStatus =
  | "draft"
  | "reviewing"
  | "passed"
  | "reviewed"
  | "review_failed"
  | "signed"
  | "transferred"
  | "deleted";

export type PrecheckSeverity = "critical" | "major" | "minor";

export interface PrecheckIssue {
  dimension: string;
  severity: PrecheckSeverity;
  quote: string;
  problem: string;
  suggestion: string;
}

export interface PrecheckRuleFinding {
  text: string;
  level: "red" | "yellow";
  reason: string;
  legal_basis?: string;
  source: string;
}

export interface PrecheckResult {
  summary: string;
  overall: "pass" | "minor" | "major" | "critical";
  issues: PrecheckIssue[];
  rule_findings: PrecheckRuleFinding[];
  has_blocking: boolean;
  model: string | null;
  unparsed: boolean;
  raw_output?: string;
}

export interface PrecheckListRow {
  id: number;
  precheck_no: string;
  title: string;
  direction: "inbound" | "outbound";
  counterparty: string | null;
  created_by_userid: string;
  status: PrecheckStatus;
  current_round: number;
  file_name: string | null;
  contract_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PrecheckRound {
  id: number;
  round: number;
  file_key: string | null;
  file_name: string | null;
  task_id: number | null;
  status: "reviewing" | "done" | "error";
  created_at: string;
  updated_at: string;
}

export interface PrecheckDetail extends PrecheckListRow {
  file_key: string | null;
  file_size: number | null;
  review_task_id: number | null;
  review_result_json: string | null;
  adopted_json: string | null;
  signed_confirmed_at: string | null;
  signed_comment: string | null;
  transferred_at: string | null;
  rounds: PrecheckRound[];
}

export interface CreatePrecheckPayload {
  title: string;
  direction: "inbound" | "outbound";
  counterparty?: string;
  file_key: string;
  file_name: string;
  file_size?: number;
  contract_text: string;
}

export const listPrechecks = async (page = 1, pageSize = 20) => {
  const res = await http.request<{
    success: boolean;
    data: PrecheckListRow[];
    pagination: { page: number; pageSize: number; total: number };
  }>("get", "/api/v1/contract-precheck", { params: { page, pageSize } });
  return res;
};

export const getPrecheck = async (id: number) => {
  const res = await http.request<{ success: boolean; data: PrecheckDetail }>(
    "get",
    `/api/v1/contract-precheck/${id}`
  );
  return res.data;
};

export const createPrecheck = async (payload: CreatePrecheckPayload) => {
  const res = await http.request<{
    success: boolean;
    data: { id: number; precheck_no: string; task_id: number };
  }>("post", "/api/v1/contract-precheck", { data: payload });
  return res.data;
};

export const reviewPrecheck = async (
  id: number,
  payload?: Omit<CreatePrecheckPayload, "title" | "direction" | "counterparty">
) => {
  const res = await http.request<{
    success: boolean;
    data: { task_id: number; round: number };
  }>("post", `/api/v1/contract-precheck/${id}/review`, { data: payload ?? {} });
  return res.data;
};

export const adoptPrecheckIssue = async (
  id: number,
  issueIndex: number,
  adopted: boolean
) => {
  const res = await http.request<{
    success: boolean;
    data: { adopted_count: number };
  }>("post", `/api/v1/contract-precheck/${id}/adopt`, {
    data: { issue_index: issueIndex, adopted }
  });
  return res.data;
};

export const confirmPrecheckSigned = async (id: number, comment?: string) => {
  await http.request<{ success: boolean }>(
    "post",
    `/api/v1/contract-precheck/${id}/confirm-signed`,
    { data: { comment } }
  );
};

export interface TransferPrecheckPayload {
  project_id: number;
  entity_id: number;
  contract_type: string;
  total_amount: number;
  contract_date?: string;
  /** 建单时可留空，转入时在弹窗补填 */
  counterparty?: string;
}

export const transferPrecheck = async (
  id: number,
  payload: TransferPrecheckPayload
) => {
  const res = await http.request<{
    success: boolean;
    data: { contract_id: number; contract_no: string };
  }>("post", `/api/v1/contract-precheck/${id}/transfer`, { data: payload });
  return res.data;
};

export const updatePrecheck = async (
  id: number,
  payload: { title?: string; counterparty?: string }
) => {
  await http.request<{ success: boolean }>(
    "put",
    `/api/v1/contract-precheck/${id}`,
    {
      data: payload
    }
  );
};

export const deletePrecheck = async (id: number) => {
  await http.request<{ success: boolean }>(
    "delete",
    `/api/v1/contract-precheck/${id}`
  );
};
