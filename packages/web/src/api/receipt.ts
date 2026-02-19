import { http } from "@/utils/http";

type Pagination = { page: number; pageSize: number; total: number };

export type Invoice = {
  id: number;
  invoice_no: string;
  contract_id: number;
  project_id: number;
  issuer_userid: string;
  issue_date: string;
  amount: number;
  title: string;
  tax_no: string | null;
  file_key: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type Receipt = {
  id: number;
  receipt_no: string;
  contract_id: number;
  project_id: number;
  invoice_id: number | null;
  receiver_userid: string;
  received_date: string;
  amount: number;
  payment_account: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export const listInvoices = (params?: {
  contract_id?: number;
  project_id?: number;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: Invoice[];
    pagination: Pagination;
  }>("get", "/api/v1/receipt/invoice", { params });
};

export const createInvoice = (data: {
  contract_id: number;
  issue_date: string;
  amount: number;
  title: string;
  tax_no?: string;
  file_key?: string;
  remark?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; invoice_no: string };
  }>("post", "/api/v1/receipt/invoice", { data });
};

export const updateInvoice = (
  id: number,
  data: {
    issue_date?: string;
    amount?: number;
    title?: string;
    tax_no?: string;
    file_key?: string;
    status?: string;
    remark?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/receipt/invoice/${id}`,
    { data }
  );
};

export const deleteInvoice = (id: number) => {
  return http.request<{ success: boolean }>(
    "delete",
    `/api/v1/receipt/invoice/${id}`
  );
};

export const listReceipts = (params?: {
  contract_id?: number;
  project_id?: number;
  invoice_id?: number;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: Receipt[];
    pagination: Pagination;
  }>("get", "/api/v1/receipt", { params });
};

export const createReceipt = (data: {
  contract_id: number;
  invoice_id?: number;
  received_date: string;
  amount: number;
  payment_account?: string;
  remark?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; receipt_no: string };
  }>("post", "/api/v1/receipt", { data });
};

export const updateReceipt = (
  id: number,
  data: {
    invoice_id?: number;
    received_date?: string;
    amount?: number;
    payment_account?: string;
    status?: string;
    remark?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/receipt/${id}`, {
    data
  });
};

export const deleteReceipt = (id: number) => {
  return http.request<{ success: boolean }>("delete", `/api/v1/receipt/${id}`);
};
