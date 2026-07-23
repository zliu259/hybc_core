import { http } from "@/utils/http";

export type DraftDirection = "inbound" | "outbound";
export type ContractFamily =
  | "pipe_jacking"
  | "equipment_lease"
  | "labor_service"
  | "materials_sale";
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
  family: ContractFamily;
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
  converted_contract_id: number | null;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
};

export type ContractDraftSection = {
  id: number;
  draft_id: number;
  section_key: string;
  title: string;
  variant_key: string;
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
  family: ContractFamily;
  section_key: string;
  direction: DraftDirection | "both";
  variant_key: string;
  variant_label: string;
  required_level: "core" | "recommended" | "optional";
  title: string;
  body_template: string;
  risk_notes: string | null;
  sort_order: number;
};

export type DraftDetail = {
  draft: ContractDraft;
  sections: ContractDraftSection[];
};

/** 完整检查 v2：复核（audit）阶段对每条问题追加的裁决 */
export type CompletenessVerdict = "confirmed" | "rejected" | "added";

/** 逐节问题单条（AI 输出，字段宽容处理；audit 阶段带 verdict/audit_note） */
export type CompletenessIssue = {
  text: string;
  severity: string;
  reason: string;
  suggestion?: string;
  verdict?: CompletenessVerdict;
  audit_note?: string;
};

/** 逐节问题分组；audit 阶段带修正稿与复核放行标记（一键修正的 gate） */
export type CompletenessSectionIssue = {
  section_key: string;
  title: string;
  issues: CompletenessIssue[];
  revised_content?: string;
  revision_approved?: boolean;
};

/** 单个模型阶段（initial/audit）的检查结论 */
export type CompletenessResult = {
  missing?: {
    section_key: string;
    title: string;
    level: string;
    reason: string;
    verdict?: string;
    audit_note?: string;
  }[];
  section_issues?: CompletenessSectionIssue[];
  overall_summary?: string;
  ready_to_finalize?: boolean;
  /** 模型输出无法解析为 JSON 时后端包为 {raw} */
  raw?: string;
};

/**
 * 完整检查 v2 前后递进结果（completeness_result_json / check.result_json）：
 * initial=terra 初版结论，audit=sonnet-5 复核把关（最终结论以 audit 为准）。
 */
export type CompletenessReport = {
  initial: { model: string; result: CompletenessResult };
  audit: { model: string; result: CompletenessResult };
};

/** 历史检查版本（列表项，倒序，最多 20） */
export type CheckVersion = {
  id: number;
  models_json: string;
  created_at: string;
};

/** 单个历史检查版本详情 */
export type CheckDetail = {
  id: number;
  result_json: string;
  models_json: string;
  created_at: string;
};

export async function listClauseTemplates(
  direction: DraftDirection,
  family: ContractFamily
): Promise<ClauseTemplate[]> {
  const res = await http.request<{ success: boolean; data: ClauseTemplate[] }>(
    "get",
    "/api/v1/contract-draft/templates",
    { params: { direction, family } }
  );
  return res.data;
}

export async function createDraft(data: {
  direction: DraftDirection;
  family?: ContractFamily;
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
  await http.request<{ success: boolean }>(
    "delete",
    `/api/v1/contract-draft/${id}`
  );
}

export async function addSection(
  draftId: number,
  payload: { section_key?: string; title?: string; variant_key?: string }
): Promise<ContractDraftSection> {
  const res = await http.request<{
    success: boolean;
    data: ContractDraftSection;
  }>("post", `/api/v1/contract-draft/${draftId}/sections`, { data: payload });
  return res.data;
}

export async function getSection(
  draftId: number,
  sectionId: number
): Promise<ContractDraftSection> {
  const res = await http.request<{
    success: boolean;
    data: ContractDraftSection;
  }>("get", `/api/v1/contract-draft/${draftId}/sections/${sectionId}`);
  return res.data;
}

export async function updateSection(
  draftId: number,
  sectionId: number,
  data: Record<string, unknown>
): Promise<ContractDraftSection> {
  const res = await http.request<{
    success: boolean;
    data: ContractDraftSection;
  }>("put", `/api/v1/contract-draft/${draftId}/sections/${sectionId}`, {
    data
  });
  return res.data;
}

export async function applyVariant(
  draftId: number,
  sectionId: number,
  variantKey: string
): Promise<ContractDraftSection> {
  const res = await http.request<{
    success: boolean;
    data: ContractDraftSection;
  }>(
    "put",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/apply-variant`,
    { data: { variant_key: variantKey } }
  );
  return res.data;
}

export async function removeSection(
  draftId: number,
  sectionId: number
): Promise<void> {
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
  const res = await http.request<{
    success: boolean;
    data: { task_id: number };
  }>(
    "post",
    `/api/v1/contract-draft/${draftId}/sections/${sectionId}/generate`,
    { data: { instruction: instruction ?? "" } }
  );
  return res.data.task_id;
}

export async function reviewSection(
  draftId: number,
  sectionId: number
): Promise<number> {
  const res = await http.request<{
    success: boolean;
    data: { task_id: number };
  }>("post", `/api/v1/contract-draft/${draftId}/sections/${sectionId}/review`, {
    data: {}
  });
  return res.data.task_id;
}

export async function requestCompleteness(draftId: number): Promise<number> {
  const res = await http.request<{
    success: boolean;
    data: { task_id: number };
  }>("post", `/api/v1/contract-draft/${draftId}/completeness-check`, {
    data: {}
  });
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

/** 历史检查版本列表（倒序，最多 20） */
export async function listChecks(draftId: number): Promise<CheckVersion[]> {
  const res = await http.request<{ success: boolean; data: CheckVersion[] }>(
    "get",
    `/api/v1/contract-draft/${draftId}/checks`
  );
  return res.data;
}

/** 单个历史检查版本详情（含 result_json 递进结果） */
export async function getCheck(
  draftId: number,
  checkId: number
): Promise<CheckDetail> {
  const res = await http.request<{ success: boolean; data: CheckDetail }>(
    "get",
    `/api/v1/contract-draft/${draftId}/checks/${checkId}`
  );
  return res.data;
}

/**
 * 一键采纳某节复核通过的修正稿（门控：仅该 checkId 的 audit 结果里
 * 该节 revision_approved===true 才成功，否则后端 400）。成功返回更新后的节。
 */
export async function applyCompletenessRevision(
  draftId: number,
  checkId: number,
  sectionKey: string
): Promise<ContractDraftSection> {
  const res = await http.request<{
    success: boolean;
    data: ContractDraftSection;
  }>(
    "post",
    `/api/v1/contract-draft/${draftId}/checks/${checkId}/apply-revision`,
    { data: { section_key: sectionKey } }
  );
  return res.data;
}

export type FixedSection = {
  id: number;
  section_key: string;
  title: string;
  content: string;
};

export async function finalizeDraft(id: number): Promise<{
  draft_id: number;
  fixed_sections: FixedSection[];
  unresolved_keys: string[];
}> {
  const res = await http.request<{
    success: boolean;
    data: {
      draft_id: number;
      fixed_sections: FixedSection[];
      unresolved_keys: string[];
    };
  }>("post", `/api/v1/contract-draft/${id}/finalize`, { data: {} });
  return res.data;
}

export async function convertDraft(
  id: number,
  payload: {
    contract_type: string;
    file_key: string;
    file_name: string;
    file_size: number;
    total_amount?: number;
    contract_date?: string;
  }
): Promise<{ contract_id: number; contract_no: string }> {
  const res = await http.request<{
    success: boolean;
    data: { contract_id: number; contract_no: string };
  }>("post", `/api/v1/contract-draft/${id}/convert`, { data: payload });
  return res.data;
}
