export const invoiceStatuses = ["issued", "cancelled", "deleted"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const receiptStatuses = ["recorded", "reversed", "deleted"] as const;
export type ReceiptStatus = (typeof receiptStatuses)[number];

export interface Invoice {
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
  status: InvoiceStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
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
  status: ReceiptStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
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

export interface CreateReceiptRequest {
  contract_id: number;
  invoice_id?: number;
  received_date: string;
  amount: number;
  payment_account?: string;
  remark?: string;
}

export interface UpdateReceiptRequest {
  invoice_id?: number;
  received_date?: string;
  amount?: number;
  payment_account?: string;
  status?: ReceiptStatus;
  remark?: string;
}
