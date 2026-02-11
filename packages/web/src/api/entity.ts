import { http } from "@/utils/http";

export type Entity = {
  id: number;
  entity_code: string;
  entity_name: string;
  legal_person: string | null;
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
  status: string;
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

export const listEntities = (params?: { status?: string; keyword?: string }) => {
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
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/entity",
    { data }
  );
};

export const updateEntity = (
  id: number,
  data: { entity_name?: string; legal_person?: string | null; status?: string }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/entity/${id}`, { data });
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
