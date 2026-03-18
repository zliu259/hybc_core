import { http } from "@/utils/http";

type Pagination = { page: number; pageSize: number; total: number };

export type AttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

export type Invoice = {
  id: number;
  invoice_no: string;
  invoice_request_id: number | null;
  contract_id: number;
  project_id: number;
  issuer_userid: string;
  issue_date: string;
  amount: number;
  title: string;
  tax_no: string | null;
  invoice_code: string | null;
  invoice_number: string | null;
  check_code: string | null;
  tax_amount: number | null;
  amount_with_tax: number | null;
  file_key: string | null;
  pdf_file_key: string | null;
  ofd_file_key: string | null;
  xml_file_key: string | null;
  qr_code: string | null;
  status: string;
  invoice_status_detail: string;
  payment_status: string;
  send_status: string;
  send_time: string | null;
  verification_status: string;
  verification_task_id: number | null;
  verification_result: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceRequest = {
  id: number;
  request_no: string;
  contract_id: number;
  project_id: number;
  customer_name: string;
  customer_tax_no: string;
  buyer_json: string | null;
  invoice_type: "special" | "normal" | "electronic";
  invoice_category: string;
  tax_rate: number;
  currency: string;
  items_json: string;
  amount_without_tax: number;
  tax_amount_estimated: number;
  amount_with_tax: number;
  business_contract_no: string | null;
  payment_reference: string | null;
  applicant_userid: string;
  approval_instance_id: number | null;
  status: string;
  review_comment: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  issued_invoice_id: number | null;
  attachments_json: string | null;
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
  receiver_entity_id: number | null;
  receiver_account_id: number | null;
  vouchers_json: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptAccountOption = {
  entity_id: number;
  entity_name: string;
  account_id: number;
  bank_name: string;
  account_name: string;
  account_no: string;
  label: string;
};

export type ReceiptRefund = {
  id: number;
  refund_no: string;
  receipt_id: number;
  contract_id: number;
  project_id: number;
  invoice_id: number | null;
  applicant_userid: string;
  refund_mode: "full" | "partial";
  amount: number;
  status: string;
  approval_instance_id: number | null;
  requires_red_invoice: number;
  red_invoice_status: string;
  bank_slips_json: string | null;
  reason: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptRefundDetail = ReceiptRefund & {
  receipt: Receipt;
  contract: {
    id: number;
    contract_no: string;
    direction: string;
    counterparty: string;
    total_amount: number;
    received_amount: number;
    invoiced_amount: number;
    status: string;
  };
  invoice: Invoice | null;
};

export type ReceiptDetail = {
  receipt: Receipt;
  contract: {
    id: number;
    contract_no: string;
    direction: string;
    counterparty: string;
    total_amount: number;
    received_amount: number;
    invoiced_amount: number;
    status: string;
  };
  invoice: Invoice | null;
  refunds: ReceiptRefund[];
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

export const listInvoiceRequests = (params?: {
  contract_id?: number;
  project_id?: number;
  status?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: InvoiceRequest[];
    pagination: Pagination;
  }>("get", "/api/v1/receipt/invoice-request", { params });
};

export const getInvoiceRequest = (id: number) => {
  return http.request<{ success: boolean; data: InvoiceRequest }>(
    "get",
    `/api/v1/receipt/invoice-request/${id}`
  );
};

export const createInvoiceRequest = (data: {
  contract_id: number;
  project_id?: number;
  customer_name?: string;
  customer_tax_no?: string;
  counterparty_name?: string;
  counterparty_tax_no?: string;
  counterparty_contact?: string;
  seller_entity_id?: number;
  seller_entity_name?: string;
  buyer_json?: string;
  invoice_type: "special" | "normal" | "electronic";
  invoice_category: string;
  tax_rate: number;
  currency?: "CNY";
  items_json: string;
  amount_without_tax: number;
  tax_amount_estimated: number;
  amount_with_tax: number;
  business_contract_no?: string;
  payment_reference?: string;
  attachments_json?: string;
  remark?: string;
}) => {
  return http.request<{
    success: boolean;
    data: { id: number; request_no: string };
  }>("post", "/api/v1/receipt/invoice-request", { data });
};

export const updateInvoiceRequest = (
  id: number,
  data: {
    project_id?: number;
    customer_name?: string;
    customer_tax_no?: string;
    counterparty_name?: string;
    counterparty_tax_no?: string;
    counterparty_contact?: string;
    seller_entity_id?: number;
    seller_entity_name?: string;
    buyer_json?: string;
    invoice_type?: "special" | "normal" | "electronic";
    invoice_category?: string;
    tax_rate?: number;
    currency?: "CNY";
    items_json?: string;
    amount_without_tax?: number;
    tax_amount_estimated?: number;
    amount_with_tax?: number;
    business_contract_no?: string;
    payment_reference?: string;
    status?: string;
    review_comment?: string;
    attachments_json?: string;
    remark?: string;
  }
) => {
  return http.request<{ success: boolean }>(
    "put",
    `/api/v1/receipt/invoice-request/${id}`,
    { data }
  );
};

export const submitInvoiceRequestApproval = (
  id: number,
  data?: { biz_summary?: string }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/receipt/invoice-request/${id}/submit-approval`, { data });
};

export const issueInvoiceFromRequest = (
  id: number,
  data: {
    file_key: string;
    pdf_file_key?: string;
    ofd_file_key?: string;
    xml_file_key?: string;
    remark?: string;
  }
) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      invoice_no: string;
      verification_task_id: number | null;
    };
  }>("post", `/api/v1/receipt/invoice-request/${id}/issue`, { data });
};

export const triggerInvoiceVerify = (
  id: number,
  data?: { file_key?: string }
) => {
  return http.request<{
    success: boolean;
    data: { task_id: number; verification_status: string };
  }>("post", `/api/v1/receipt/invoice/${id}/trigger-verify`, { data });
};

export const getInvoiceVerifyStatus = (id: number) => {
  return http.request<{
    success: boolean;
    data: {
      status: string;
      task_id: number | null;
      result: Record<string, unknown> | null;
    };
  }>("get", `/api/v1/receipt/invoice/${id}/verify-status`);
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

export const listReceiptAccounts = () => {
  return http.request<{ success: boolean; data: ReceiptAccountOption[] }>(
    "get",
    "/api/v1/receipt/receipt-accounts"
  );
};

export const getReceipt = (id: number) => {
  return http.request<{ success: boolean; data: ReceiptDetail }>(
    "get",
    `/api/v1/receipt/${id}`
  );
};

export const createReceipt = (data: {
  contract_id: number;
  invoice_id?: number;
  received_date: string;
  amount: number;
  payment_account?: string;
  receiver_entity_id?: number;
  receiver_account_id?: number;
  vouchers_json?: string;
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
    receiver_entity_id?: number;
    receiver_account_id?: number;
    vouchers_json?: string;
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

export const listReceiptRefunds = (params?: {
  receipt_id?: number;
  status?: string;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: ReceiptRefund[];
    pagination: Pagination;
  }>("get", "/api/v1/receipt/refund", { params });
};

export const getReceiptRefund = (id: number) => {
  return http.request<{ success: boolean; data: ReceiptRefundDetail }>(
    "get",
    `/api/v1/receipt/refund/${id}`
  );
};

export const createReceiptRefund = (data: {
  receipt_id: number;
  refund_mode: "full" | "partial";
  amount?: number;
  reason?: string;
  remark?: string;
}) => {
  return http.request<{
    success: boolean;
    data: {
      id: number;
      refund_no: string;
      amount: number;
      requires_red_invoice: number;
      refundable_remaining: number;
    };
  }>("post", "/api/v1/receipt/refund", { data });
};

export const submitReceiptRefundApproval = (
  id: number,
  data?: { biz_summary?: string }
) => {
  return http.request<{
    success: boolean;
    data: { approval_instance_id: number; instance_no: string };
  }>("post", `/api/v1/receipt/refund/${id}/submit-approval`, { data });
};

export const updateReceiptRefundBankSlips = (
  id: number,
  data: { bank_slips_json: string; append?: boolean }
) => {
  return http.request<{
    success: boolean;
    data: { id: number; bank_slips_json: string };
  }>("patch", `/api/v1/receipt/refund/${id}/bank-slips`, { data });
};
