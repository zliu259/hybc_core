import { http } from "@/utils/http";

export type FinanceSnapshotBizType = "all" | "outbound" | "internal" | "receipt";
export type FinanceSnapshotPeriodType = "month" | "year";

export type FinanceSnapshotDetail = {
  biz_type: "outbound" | "internal" | "receipt";
  biz_type_label: string;
  biz_id: number;
  biz_no: string;
  project_id: number;
  project_name: string | null;
  admin_userid: string;
  amount: number;
  status: string;
  approval_instance_id: number | null;
  occurred_at: string;
  latest_trace_at: string;
  link_path: string;
  track_note: string;
};

export const getFinanceSnapshot = (params: {
  period_type: FinanceSnapshotPeriodType;
  period?: string;
  project_id?: number;
  admin_userid?: string;
  biz_type?: FinanceSnapshotBizType;
  page?: number;
  pageSize?: number;
}) => {
  return http.request<{
    success: boolean;
    data: {
      filters: {
        period_type: FinanceSnapshotPeriodType;
        period: string;
        start_date: string;
        end_date: string;
        project_id: number | null;
        admin_userid: string | null;
        biz_type: FinanceSnapshotBizType;
      };
      summary: {
        outbound: {
          count: number;
          total_amount: number;
          completed_amount: number;
          pending_count: number;
        };
        internal: {
          count: number;
          total_amount: number;
          completed_amount: number;
          pending_count: number;
        };
        receipt: {
          count: number;
          total_amount: number;
          completed_amount: number;
          pending_count: number;
        };
        total_amount: number;
      };
      charts: {
        trend: Array<{
          bucket: string;
          outbound_amount: number;
          internal_amount: number;
          receipt_amount: number;
          total_amount: number;
        }>;
        structure: Array<{
          biz_type: "outbound" | "internal" | "receipt";
          biz_type_label: string;
          amount: number;
        }>;
        status_breakdown: Array<{
          biz_type: "outbound" | "internal" | "receipt";
          biz_type_label: string;
          status: string;
          count: number;
          amount: number;
        }>;
      };
      details: FinanceSnapshotDetail[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
      };
    };
  }>("get", "/api/v1/dashboard/finance-snapshot", { params });
};
