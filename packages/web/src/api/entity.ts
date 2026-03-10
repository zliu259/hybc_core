import { http } from "@/utils/http";

export type Entity = {
  id: number;
  entity_code: string;
  entity_name: string;
  legal_person: string | null;
  tax_id: string | null;
  company_attribute: "self_owned" | "external" | "shareholder_personal";
  storage_quota_mb: number;
  storage_used_mb: number;
  primary_bank_name: string | null;
  primary_bank_branch_no: string | null;
  primary_bank_account_no: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type EntityBankAccount = {
  id: number;
  entity_id: number;
  bank_name: string;
  account_name: string;
  account_no: string;
  bank_branch_no: string | null;
  bank_line_no: string | null;
  status: string;
};

export type EntityAttachment = {
  id: number;
  entity_id: number;
  file_key: string;
  file_name: string;
  file_size: number | null;
  file_category: string;
  status: string;
  uploaded_by_userid: string;
  created_at: string;
  updated_at: string;
};

export type EntityInvoiceProfile = {
  id: number;
  entity_id: number;
  invoice_title: string;
  tax_no: string;
  address: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
};

export const listEntities = (params?: {
  status?: string;
  keyword?: string;
}) => {
  return http.request<{ success: boolean; data: Entity[] }>(
    "get",
    "/api/v1/entity",
    { params }
  );
};

export const createEntity = (data: {
  entity_code: string;
  entity_name: string;
  legal_person?: string;
  tax_id?: string;
  company_attribute?: "self_owned" | "external" | "shareholder_personal";
  storage_quota_mb?: number;
  primary_bank_name?: string;
  primary_bank_branch_no?: string;
  primary_bank_account_no?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/entity",
    { data }
  );
};

export const updateEntity = (
  id: number,
  data: {
    entity_name?: string;
    legal_person?: string | null;
    tax_id?: string | null;
    company_attribute?: "self_owned" | "external" | "shareholder_personal";
    storage_quota_mb?: number;
    storage_used_mb?: number;
    primary_bank_name?: string | null;
    primary_bank_branch_no?: string | null;
    primary_bank_account_no?: string | null;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/entity/${id}`, {
    data
  });
};

export const deleteEntity = (id: number) => {
  return http.request<{ success: boolean }>("delete", `/api/v1/entity/${id}`);
};

export const listEntityBankAccounts = (entityId: number) => {
  return http.request<{ success: boolean; data: EntityBankAccount[] }>(
    "get",
    `/api/v1/entity/${entityId}/bank-accounts`
  );
};

export const createEntityBankAccount = (
  entityId: number,
  data: {
    bank_name: string;
    account_name: string;
    account_no: string;
    bank_branch_no?: string;
    bank_line_no?: string;
    status?: string;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/entity/${entityId}/bank-accounts`,
    { data }
  );
};

export const listEntityInvoiceProfiles = (entityId: number) => {
  return http.request<{ success: boolean; data: EntityInvoiceProfile[] }>(
    "get",
    `/api/v1/entity/${entityId}/invoice-profiles`
  );
};

export const createEntityInvoiceProfile = (
  entityId: number,
  data: {
    invoice_title: string;
    tax_no: string;
    address?: string;
    phone?: string;
    bank_name?: string;
    bank_account?: string;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/entity/${entityId}/invoice-profiles`,
    { data }
  );
};

export const listEntityAttachments = (entityId: number) => {
  return http.request<{ success: boolean; data: EntityAttachment[] }>(
    "get",
    `/api/v1/entity/${entityId}/attachments`
  );
};

export const createEntityAttachment = (
  entityId: number,
  data: {
    file_key: string;
    file_name: string;
    file_size?: number;
    file_category?: string;
  }
) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    `/api/v1/entity/${entityId}/attachments`,
    { data }
  );
};

export const deleteEntityAttachment = (entityId: number, attachmentId: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/entity/${entityId}/attachments/${attachmentId}`
  );
};

export const getEntityStorageSummary = (entityId: number) => {
  return http.request<{
    success: boolean;
    data: {
      storage_quota_mb: number;
      storage_used_mb: number;
      storage_remaining_mb: number;
      active_attachment_count: number;
    };
  }>("get", `/api/v1/entity/${entityId}/storage-summary`);
};
