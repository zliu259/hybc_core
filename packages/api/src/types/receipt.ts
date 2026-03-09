import type { Contract } from "./contract";

export const invoiceRequestStatuses = [
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "ready_to_issue",
  "issued",
  "cancelled"
] as const;
export type InvoiceRequestStatus = (typeof invoiceRequestStatuses)[number];

export const invoiceStatuses = ["issued", "cancelled", "red_issued", "voided", "deleted"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const receiptStatuses = ["recorded", "reversed", "deleted"] as const;
export type ReceiptStatus = (typeof receiptStatuses)[number];

export const receiptRefundStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "cancelled",
  "completed"
] as const;
export type ReceiptRefundStatus = (typeof receiptRefundStatuses)[number];

export interface Invoice {
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
  status: InvoiceStatus;
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
}

export interface InvoiceRequest {
  id: number;
  request_no: string;
  contract_id: number;
  project_id: number;
  customer_name: string;
  customer_tax_no: string;
  buyer_json: string | null;
  invoice_type: string;
  invoice_category: string;
  tax_rate: number;
  currency: string;
  items_json: string;
  amount_without_tax: number;
  tax_amount_estimated: number;
  amount_with_tax: number;
  business_contract_no: string | null;
  delivery_reference: string | null;
  payment_reference: string | null;
  applicant_userid: string;
  department: string | null;
  approval_instance_id: number | null;
  status: InvoiceRequestStatus;
  review_comment: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  issued_invoice_id: number | null;
  attachments_json: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceRequestPayload {
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
}

export interface UpdateInvoiceRequestPayload {
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
  attachments_json?: string;
  status?: InvoiceRequestStatus;
  review_comment?: string;
  remark?: string;
}

export interface IssueInvoiceFromRequestPayload {
  file_key: string;
  pdf_file_key?: string;
  ofd_file_key?: string;
  xml_file_key?: string;
  remark?: string;
}

export interface Receipt {
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
  status: ReceiptStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptRefund {
  id: number;
  refund_no: string;
  receipt_id: number;
  contract_id: number;
  project_id: number;
  invoice_id: number | null;
  applicant_userid: string;
  refund_mode: "full" | "partial";
  amount: number;
  status: ReceiptRefundStatus;
  approval_instance_id: number | null;
  requires_red_invoice: number;
  red_invoice_status: string;
  reason: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReceiptRefundDetail extends ReceiptRefund {
  receipt: Receipt;
  contract: Contract;
  invoice: Invoice | null;
}

export interface ReceiptAccountOption {
  entity_id: number;
  entity_name: string;
  account_id: number;
  bank_name: string;
  account_name: string;
  account_no: string;
  label: string;
}

export interface CreateInvoiceRequest {
  contract_id: number;
  issue_date: string;
  amount: number;
  title: string;
  tax_no?: string;
  file_key?: string;
  remark?: string;
}

export interface UpdateInvoiceRequest {
  issue_date?: string;
  amount?: number;
  title?: string;
  tax_no?: string;
  file_key?: string;
  status?: InvoiceStatus;
  remark?: string;
}

export interface TriggerInvoiceVerifyPayload {
  file_key?: string;
}

export interface CreateReceiptRequest {
  contract_id: number;
  invoice_id?: number;
  received_date: string;
  amount: number;
  payment_account?: string;
  receiver_entity_id?: number;
  receiver_account_id?: number;
  vouchers_json?: string;
  remark?: string;
}

export interface UpdateReceiptRequest {
  invoice_id?: number;
  received_date?: string;
  amount?: number;
  payment_account?: string;
  receiver_entity_id?: number;
  receiver_account_id?: number;
  vouchers_json?: string;
  status?: ReceiptStatus;
  remark?: string;
}

export interface CreateReceiptRefundRequest {
  receipt_id: number;
  refund_mode: "full" | "partial";
  amount?: number;
  reason?: string;
  remark?: string;
}
