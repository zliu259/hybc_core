import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";

type PeriodType = "month" | "year";

const nowIso = () => new Date().toISOString();

const parsePeriodRange = (periodType: PeriodType, period: string | undefined) => {
  const now = new Date();
  if (periodType === "year") {
    const year = period && /^\d{4}$/.test(period) ? Number(period) : now.getFullYear();
    const start = `${String(year)}-01-01`;
    const end = `${String(year + 1)}-01-01`;
    return {
      periodLabel: String(year),
      start,
      end
    };
  }

  const normalized = period && /^\d{4}-\d{2}$/.test(period) ? period : nowIso().slice(0, 7);
  const [yearText, monthText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const monthStart = `${yearText}-${monthText}-01`;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthText = String(nextMonth).padStart(2, "0");
  const monthEnd = `${String(nextMonthYear)}-${nextMonthText}-01`;

  return {
    periodLabel: normalized,
    start: monthStart,
    end: monthEnd
  };
};

const toTypeLabel = (bizType: string) => {
  if (bizType === "outbound") return "对外付款";
  if (bizType === "internal") return "对内付款";
  return "收款";
};

const toTrackNote = (bizType: string, status: string) => {
  if (bizType === "outbound") {
    if (status === "paid") return "已完成付款";
    if (status === "approved") return "审批通过待付款";
    if (status === "pending_approval") return "审批进行中";
    if (status === "rejected") return "审批驳回";
    return "流程处理中";
  }

  if (bizType === "internal") {
    if (status === "paid") return "报销已支付";
    if (status === "approved") return "审批通过待支付";
    if (status === "pending_approval") return "审批进行中";
    if (status === "rejected") return "审批驳回";
    return "批次处理中";
  }

  if (status === "recorded") return "已登记到账";
  if (status === "reversed") return "已冲销";
  return "收款处理中";
};

export const dashboardRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

dashboardRoutes.use("*", authMiddleware);

dashboardRoutes.get("/", (c) => c.json({ module: "dashboard", ready: true }));

dashboardRoutes.get(
  "/finance-snapshot",
  requireRoles(["super_admin", "manager", "site_manager", "finance", "operator"]),
  async (c) => {
    const periodTypeRaw = c.req.query("period_type");
    const periodType: PeriodType = periodTypeRaw === "year" ? "year" : "month";
    const period = c.req.query("period");
    const projectIdRaw = c.req.query("project_id");
    const adminUseridRaw = c.req.query("admin_userid");
    const bizTypeRaw = c.req.query("biz_type") ?? "all";
    const page = Number(c.req.query("page") ?? "1");
    const pageSize = Number(c.req.query("pageSize") ?? "20");
    const offset = (page - 1) * pageSize;

    const projectId = projectIdRaw ? Number(projectIdRaw) : null;
    const adminUserid = adminUseridRaw?.trim() ? adminUseridRaw.trim() : null;
    const bizType = ["all", "outbound", "internal", "receipt"].includes(bizTypeRaw)
      ? bizTypeRaw
      : "all";

    const range = parsePeriodRange(periodType, period);

    const whereParts = ["u.occurred_at >= ?", "u.occurred_at < ?"];
    const whereParams: Array<string | number> = [range.start, range.end];

    if (projectId && Number.isFinite(projectId)) {
      whereParts.push("u.project_id = ?");
      whereParams.push(projectId);
    }
    if (adminUserid) {
      whereParts.push("u.admin_userid = ?");
      whereParams.push(adminUserid);
    }
    if (bizType !== "all") {
      whereParts.push("u.biz_type = ?");
      whereParams.push(bizType);
    }

    const unifiedSql = `
      SELECT
        'outbound' AS biz_type,
        p.id AS biz_id,
        p.serial_no AS biz_no,
        p.project_id,
        p.applicant_userid AS admin_userid,
        p.amount,
        p.status,
        p.approval_instance_id,
        COALESCE(NULLIF(p.paid_at, ''), NULLIF(p.expected_payment_date, ''), p.created_at) AS occurred_at,
        p.updated_at AS latest_trace_at,
        '/finance/payment/detail/' || p.id AS link_path
      FROM payment_request p
      WHERE p.status != 'cancelled'
      UNION ALL
      SELECT
        'internal' AS biz_type,
        b.id AS biz_id,
        b.batch_no AS biz_no,
        b.project_id,
        b.applicant_userid AS admin_userid,
        b.total_amount AS amount,
        b.status,
        b.approval_instance_id,
        b.created_at AS occurred_at,
        b.updated_at AS latest_trace_at,
        '/finance/reimbursement/batch/' || b.id AS link_path
      FROM reimbursement_batch b
      WHERE b.status != 'deleted'
      UNION ALL
      SELECT
        'receipt' AS biz_type,
        r.id AS biz_id,
        r.receipt_no AS biz_no,
        r.project_id,
        r.receiver_userid AS admin_userid,
        r.amount,
        r.status,
        NULL AS approval_instance_id,
        COALESCE(NULLIF(r.received_date, ''), r.created_at) AS occurred_at,
        r.updated_at AS latest_trace_at,
        '/finance/receipt' AS link_path
      FROM receipt r
      WHERE r.status != 'deleted'
    `;

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const summaryRows = await c.env.DB.prepare(
      `SELECT
         u.biz_type,
         COUNT(*) AS count,
         IFNULL(SUM(u.amount), 0) AS total_amount,
         IFNULL(SUM(CASE
           WHEN u.biz_type = 'outbound' AND u.status = 'paid' THEN u.amount
           WHEN u.biz_type = 'internal' AND u.status IN ('approved', 'paid') THEN u.amount
           WHEN u.biz_type = 'receipt' AND u.status = 'recorded' THEN u.amount
           ELSE 0
         END), 0) AS completed_amount,
         IFNULL(SUM(CASE
           WHEN u.biz_type = 'outbound' AND u.status IN ('draft', 'pending_approval', 'approved') THEN 1
           WHEN u.biz_type = 'internal' AND u.status IN ('draft', 'pending_approval') THEN 1
           WHEN u.biz_type = 'receipt' AND u.status != 'recorded' THEN 1
           ELSE 0
         END), 0) AS pending_count
       FROM (${unifiedSql}) u
       ${whereSql}
       GROUP BY u.biz_type`
    )
      .bind(...whereParams)
      .all<{
        biz_type: string;
        count: number;
        total_amount: number;
        completed_amount: number;
        pending_count: number;
      }>();

    const summaryMap = new Map((summaryRows.results ?? []).map((item) => [item.biz_type, item]));
    const outbound = summaryMap.get("outbound") ?? {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    };
    const internal = summaryMap.get("internal") ?? {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    };
    const receipt = summaryMap.get("receipt") ?? {
      count: 0,
      total_amount: 0,
      completed_amount: 0,
      pending_count: 0
    };

    const bucketExpr = periodType === "year" ? "substr(u.occurred_at, 1, 7)" : "substr(u.occurred_at, 1, 10)";
    const trendRows = await c.env.DB.prepare(
      `SELECT
         ${bucketExpr} AS bucket,
         IFNULL(SUM(CASE WHEN u.biz_type = 'outbound' THEN u.amount ELSE 0 END), 0) AS outbound_amount,
         IFNULL(SUM(CASE WHEN u.biz_type = 'internal' THEN u.amount ELSE 0 END), 0) AS internal_amount,
         IFNULL(SUM(CASE WHEN u.biz_type = 'receipt' THEN u.amount ELSE 0 END), 0) AS receipt_amount,
         IFNULL(SUM(u.amount), 0) AS total_amount
       FROM (${unifiedSql}) u
       ${whereSql}
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
      .bind(...whereParams)
      .all<{
        bucket: string;
        outbound_amount: number;
        internal_amount: number;
        receipt_amount: number;
        total_amount: number;
      }>();

    const statusRows = await c.env.DB.prepare(
      `SELECT u.biz_type, u.status, COUNT(*) AS count, IFNULL(SUM(u.amount), 0) AS amount
       FROM (${unifiedSql}) u
       ${whereSql}
       GROUP BY u.biz_type, u.status
       ORDER BY u.biz_type ASC, amount DESC`
    )
      .bind(...whereParams)
      .all<{
        biz_type: string;
        status: string;
        count: number;
        amount: number;
      }>();

    const detailRows = await c.env.DB.prepare(
      `SELECT
         u.*,
         p.project_name
       FROM (${unifiedSql}) u
       LEFT JOIN project p ON p.id = u.project_id
       ${whereSql}
       ORDER BY u.occurred_at DESC, u.biz_id DESC
       LIMIT ? OFFSET ?`
    )
      .bind(...whereParams, pageSize, offset)
      .all<{
        biz_type: string;
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
      }>();

    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM (${unifiedSql}) u
       ${whereSql}`
    )
      .bind(...whereParams)
      .first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        filters: {
          period_type: periodType,
          period: range.periodLabel,
          start_date: range.start,
          end_date: range.end,
          project_id: projectId,
          admin_userid: adminUserid,
          biz_type: bizType
        },
        summary: {
          outbound: {
            count: outbound.count,
            total_amount: outbound.total_amount,
            completed_amount: outbound.completed_amount,
            pending_count: outbound.pending_count
          },
          internal: {
            count: internal.count,
            total_amount: internal.total_amount,
            completed_amount: internal.completed_amount,
            pending_count: internal.pending_count
          },
          receipt: {
            count: receipt.count,
            total_amount: receipt.total_amount,
            completed_amount: receipt.completed_amount,
            pending_count: receipt.pending_count
          },
          total_amount: outbound.total_amount + internal.total_amount + receipt.total_amount
        },
        charts: {
          trend: trendRows.results ?? [],
          structure: [
            {
              biz_type: "outbound",
              biz_type_label: toTypeLabel("outbound"),
              amount: outbound.total_amount
            },
            {
              biz_type: "internal",
              biz_type_label: toTypeLabel("internal"),
              amount: internal.total_amount
            },
            {
              biz_type: "receipt",
              biz_type_label: toTypeLabel("receipt"),
              amount: receipt.total_amount
            }
          ],
          status_breakdown: (statusRows.results ?? []).map((item) => ({
            ...item,
            biz_type_label: toTypeLabel(item.biz_type)
          }))
        },
        details: (detailRows.results ?? []).map((item) => ({
          ...item,
          biz_type_label: toTypeLabel(item.biz_type),
          track_note: toTrackNote(item.biz_type, item.status)
        })),
        pagination: {
          page,
          pageSize,
          total: totalRow?.total ?? 0
        }
      }
    });
  }
);

dashboardRoutes.get(
  "/vehicle-fuel-overview",
  requireRoles(["super_admin", "manager", "finance", "site_manager"]),
  async (c) => {
    const periodTypeRaw = c.req.query("period_type");
    const periodType: PeriodType = periodTypeRaw === "year" ? "year" : "month";
    const period = c.req.query("period");
    const range = parsePeriodRange(periodType, period);

    const vehicleCountRow = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_total,
        SUM(CASE WHEN ownership_type = 'company_owned' THEN 1 ELSE 0 END) as company_owned_total,
        SUM(CASE WHEN ownership_type = 'employee_owned' THEN 1 ELSE 0 END) as employee_owned_total
       FROM company_vehicle`
    )
      .first<{
        total: number;
        active_total: number;
        company_owned_total: number;
        employee_owned_total: number;
      }>();

    const mileageRows = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as log_count,
        IFNULL(SUM(mileage_km), 0) as mileage_total
       FROM company_vehicle_mileage_log m
       JOIN company_vehicle v ON v.id = m.vehicle_id
       WHERE m.recorded_at >= ? AND m.recorded_at < ?`
    )
      .bind(range.start, range.end)
      .first<{ log_count: number; mileage_total: number }>();

    const fuelRows = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as apply_count,
        IFNULL(SUM(requested_amount), 0) as requested_amount_total,
        SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count
       FROM fuel_quota_application a
       JOIN company_vehicle v ON v.id = a.vehicle_id
       WHERE a.requested_at >= ? AND a.requested_at < ?`
    )
      .bind(range.start, range.end)
      .first<{
        apply_count: number;
        requested_amount_total: number;
        processed_count: number;
        rejected_count: number;
        pending_count: number;
      }>();

    const trendBucket = periodType === "year" ? "substr(a.requested_at, 1, 7)" : "substr(a.requested_at, 1, 10)";
    const trendRows = await c.env.DB.prepare(
      `SELECT
        ${trendBucket} as bucket,
        COUNT(*) as apply_count,
        IFNULL(SUM(a.requested_amount), 0) as requested_amount_total
       FROM fuel_quota_application a
       JOIN company_vehicle v ON v.id = a.vehicle_id
       WHERE a.requested_at >= ? AND a.requested_at < ?
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
      .bind(range.start, range.end)
      .all<{ bucket: string; apply_count: number; requested_amount_total: number }>();

    const topVehicles = await c.env.DB.prepare(
      `SELECT
        v.id,
        v.vehicle_uuid,
        v.current_plate_no,
        v.ownership_type,
        COUNT(a.id) as apply_count,
        IFNULL(SUM(a.requested_amount), 0) as requested_amount_total
       FROM company_vehicle v
       LEFT JOIN fuel_quota_application a ON a.vehicle_id = v.id AND a.requested_at >= ? AND a.requested_at < ?
       GROUP BY v.id, v.vehicle_uuid, v.current_plate_no, v.ownership_type
       ORDER BY requested_amount_total DESC, apply_count DESC
       LIMIT 10`
    )
      .bind(range.start, range.end)
      .all<{
        id: number;
        vehicle_uuid: string;
        current_plate_no: string;
        ownership_type: string;
        apply_count: number;
        requested_amount_total: number;
      }>();

    const cardBalanceRows = await c.env.DB.prepare(
      "SELECT COUNT(*) as card_count, IFNULL(SUM(latest_balance), 0) as card_balance_total FROM fuel_card WHERE status = 'active'"
    ).first<{ card_count: number; card_balance_total: number }>();

    return c.json({
      success: true,
      data: {
        filters: {
          period_type: periodType,
          period: range.periodLabel,
          start_date: range.start,
          end_date: range.end
        },
        summary: {
          vehicle_total: vehicleCountRow?.total ?? 0,
          active_vehicle_total: vehicleCountRow?.active_total ?? 0,
          company_owned_vehicle_total: vehicleCountRow?.company_owned_total ?? 0,
          employee_owned_vehicle_total: vehicleCountRow?.employee_owned_total ?? 0,
          mileage_log_count: mileageRows?.log_count ?? 0,
          mileage_km_total: mileageRows?.mileage_total ?? 0,
          fuel_apply_count: fuelRows?.apply_count ?? 0,
          fuel_requested_amount_total: fuelRows?.requested_amount_total ?? 0,
          fuel_processed_count: fuelRows?.processed_count ?? 0,
          fuel_rejected_count: fuelRows?.rejected_count ?? 0,
          fuel_pending_count: fuelRows?.pending_count ?? 0,
          active_card_count: cardBalanceRows?.card_count ?? 0,
          active_card_balance_total: cardBalanceRows?.card_balance_total ?? 0
        },
        charts: {
          fuel_apply_trend: trendRows.results ?? [],
          top_vehicles: topVehicles.results ?? []
        }
      }
    });
  }
);
