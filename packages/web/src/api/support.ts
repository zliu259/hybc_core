import { http } from "@/utils/http";

export type SupportTicketCategory =
  | "account_issue"
  | "permission_missing"
  | "system_error"
  | "feature_suggestion"
  | "other";

export type SupportTicketStatus = "pending" | "resolved";

export type SupportTicket = {
  id: number;
  category: SupportTicketCategory;
  description: string;
  attachments: string[];
  status: SupportTicketStatus;
  reply: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketDetail = SupportTicket & {
  resolved_by?: string | null;
  resolved_at?: string | null;
};

export const createSupportTicket = (data: {
  category: SupportTicketCategory;
  description: string;
  attachments?: string[];
}) => {
  return http.request<{ success: boolean; data: SupportTicket }>(
    "post",
    "/api/v1/support/tickets",
    { data }
  );
};

export const listMySupportTickets = () => {
  return http.request<{ success: boolean; data: SupportTicket[] }>(
    "get",
    "/api/v1/support/tickets",
    {
      params: {
        creator_id: "me"
      }
    }
  );
};

export const listSupportTickets = (params?: {
  status?: SupportTicketStatus;
  category?: SupportTicketCategory;
}) => {
  return http.request<{ success: boolean; data: SupportTicket[] }>(
    "get",
    "/api/v1/support/tickets",
    { params }
  );
};

export const getSupportTicket = (id: number) => {
  return http.request<{ success: boolean; data: SupportTicketDetail }>(
    "get",
    `/api/v1/support/tickets/${id}`
  );
};

export const resolveSupportTicket = (
  id: number,
  data: { reply: string; status?: SupportTicketStatus }
) => {
  return http.request<{ success: boolean }>(
    "post",
    `/api/v1/support/tickets/${id}/resolve`,
    { data }
  );
};
