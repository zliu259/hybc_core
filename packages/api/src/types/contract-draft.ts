export const contractDraftStatuses = ["drafting", "finalized", "converted", "deleted"] as const;
export type ContractDraftStatus = (typeof contractDraftStatuses)[number];

export const draftDirections = ["inbound", "outbound"] as const;
export type DraftDirection = (typeof draftDirections)[number];

export const sectionAiStatuses = ["generating", "done", "error"] as const;
export type SectionAiStatus = (typeof sectionAiStatuses)[number];

export interface RiskAnnotation {
  text: string;
  level: "red" | "yellow";
  reason: string;
  legal_basis?: string;
  source: "ai" | "rule";
}

export interface ContractDraft {
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
  status: ContractDraftStatus;
  completeness_status: string | null;
  completeness_task_id: number | null;
  completeness_result_json: string | null;
  ignored_hints_json: string;
  converted_contract_id: number | null;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
}

export interface ContractDraftSection {
  id: number;
  draft_id: number;
  section_key: string;
  title: string;
  source: "default_template" | "ai_generated" | "manual";
  instruction: string | null;
  content: string;
  risk_annotations_json: string | null;
  ai_task_id: number | null;
  ai_status: SectionAiStatus | null;
  review_task_id: number | null;
  review_status: SectionAiStatus | null;
  review_result_json: string | null;
  sort_order: number;
  status: "active" | "deleted";
  created_at: string;
  updated_at: string;
}

export interface ContractClauseTemplate {
  id: number;
  section_key: string;
  direction: DraftDirection | "both";
  required_level: "core" | "recommended" | "optional";
  title: string;
  body_template: string;
  style_ref: string | null;
  risk_notes: string | null;
  sort_order: number;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}
