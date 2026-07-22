import { http } from "@/utils/http";

export type DraftDirection = "inbound" | "outbound";
export type SectionAiStatus = "generating" | "done" | "error" | null;

export type RiskAnnotation = {
  text: string;
  level: "red" | "yellow";
  reason: string;
  legal_basis?: string;
  source: "ai" | "rule";
};

export type ContractDraft = {
  id: number;
  title: string;
  direction: DraftDirection;
  project_id: number | null;
  entity_id: number | null;
  counterparty_name: string;
  counterparty_credit_code: string | null;
  counterparty_legal_person: string | null;
  counterparty_address: string | null;
  counterparty_contact: string | null;
  counterparty_phone: string | null;
  counterparty_bank_name: string | null;
  counterparty_bank_account: string | null;
  keywords_json: string;
  status: string;
  completeness_status: string | null;
  completeness_result_json: string | null;
  ignored_hints_json: string;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
};

export type ContractDraftSection = {
  id: number;
  draft_id: number;
  section_key: string;
  title: string;
  source: "default_template" | "ai_generated" | "manual";
  instruction: string | null;
  content: string;
  risk_annotations_json: string | null;
  ai_task_id: number | null;
  ai_status: SectionAiStatus;
  review_task_id: number | null;
  review_status: SectionAiStatus;
  review_result_json: string | null;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ClauseTemplate = {
  id: number;
  section_key: string;
  direction: DraftDirection | "both";
  required_level: "core" | "recommended" | "optional";
  title: string;
  body_template: string;
  risk_notes: string | null;
  sort_order: number;
};

export type DraftDetail = { draft: ContractDraft; sections: ContractDraftSection[] };

export async function listClauseTemplates(direction: DraftDirection): Promise<ClauseTemplate[]> {
  const res = await http.request<{ success: boolean; data: ClauseTemplate[] }>(
    "get",
    "/api/v1/contract-draft/templates",
    { params: { direction } }
  );
  return res.data;
}

export async function createDraft(data: {
  direction: DraftDirection;
  title?: string;
  counterparty_name?: string;
  project_id?: number;
  entity_id?: number;
}): Promise<DraftDetail> {
  const res = await http.request<{ success: boolean; data: DraftDetail }>(
    "post",
    "/api/v1/contract-draft",
    { data }
  );
  return res.data;
}

export async function listDrafts(): Promise<ContractDraft[]> {
  const res = await http.request<{ success: boolean; data: ContractDraft[] }>(
    "get",
    "/api/v1/contract-draft"
  );
  return res.data;
}

export async function getDraft(id: number): Promise<DraftDetail> {
  const res = await http.request<{ success: boolean; data: DraftDetail }>(
    "get",
    `/api/v1/contract-draft/${id}`
  );
  return res.data;
}

export async function updateDraft(
  id: number,
  data: Record<string, unknown>
): Promise<{ draft: ContractDraft; keyword_findings: RiskAnnotation[] }> {
  const res = await http.request<{
    success: boolean;
    data: { draft: ContractDraft; keyword_findings: RiskAnnotation[] };
  }>("put", `/api/v1/contract-draft/${id}`, { data });
  return res.data;
}

export async function deleteDraft(id: number): Promise<void> {
  await http.request<{ success: boolean }>("delete", `/api/v1/contract-draft/${id}`);
}

export async function addSection(
  draftId: number,
  payload: { section_key?: string; title?: string }
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections`,
    { data: payload }
  );
  return res.data;
}

export async function getSection(
  draftId: number,
  sectionId: number
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "get",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`
  );
  return res.data;
}

export async function updateSection(
  draftId: number,
  sectionId: number,
  data: Record<string, unknown>
): Promise<ContractDraftSection> {
  const res = await http.request<{ success: boolean; data: ContractDraftSection }>(
    "put",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`,
    { data }
  );
  return res.data;
}

export async function removeSection(draftId: number, sectionId: number): Promise<void> {
  await http.request<{ success: boolean }>(
    "delete",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}`
  );
}

export async function generateSection(
  draftId: number,
  sectionId: number,
  instruction?: string
): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/generate`,
    { data: { instruction: instruction ?? "" } }
  );
  return res.data.task_id;
}

export async function reviewSection(draftId: number, sectionId: number): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/review`,
    { data: {} }
  );
  return res.data.task_id;
}

export async function requestCompleteness(draftId: number): Promise<number> {
  const res = await http.request<{ success: boolean; data: { task_id: number } }>(
    "post",
    `/api/v1/contract-draft/${draftId}/completeness-check`,
    { data: {} }
  );
  return res.data.task_id;
}

export async function ignoreCompletenessHint(
  draftId: number,
  sectionKey: string
): Promise<void> {
  await http.request<{ success: boolean }>(
    "post",
    `/api/v1/contract-draft/${draftId}/completeness-ignore`,
    { data: { section_key: sectionKey } }
  );
}
