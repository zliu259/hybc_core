import type { Env } from "../types/env";
import { createFleetNotificationRecord } from "./fleet-governance";
import { sendWeComTemplateCard } from "./wecom-approval-push";

export type FleetNotificationType =
  | "submitted"
  | "timeout"
  | "processed"
  | "needs_info"
  | "balance_warning";

export type FleetNotificationCardInput = {
  notification_type: FleetNotificationType;
  application_no: string;
  applicant_name: string;
  amount_text: string;
  risk_summary: string | null;
  detail_url: string;
};

type FleetNotificationRow = {
  id: number;
  application_id: number | null;
  notification_type: string;
  target_userids_json: string | null;
  target_group_key: string | null;
  message_summary: string;
};

type FuelQuotaApplicationNotificationRow = {
  id: number;
  application_no: string;
  applicant_userid: string;
  requested_amount: number | null;
  risk_summary: string | null;
};

type DeliverPendingFleetNotificationsResult = {
  sent: number;
  failed: number;
  skipped: number;
};

type DeliverPendingFleetNotificationsOptions = {
  limit?: number;
  notificationId?: number;
};

const financeOfficeTargetsKey = "fleet:fuel:finance-office-targets";

const nowIso = () => new Date().toISOString();
const staleSendingCutoffIso = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

const notificationTitles: Record<FleetNotificationType, string> = {
  submitted: "油卡申请待处理",
  timeout: "油卡申请超时提醒",
  processed: "油卡申请已处理",
  needs_info: "油卡申请需补充资料",
  balance_warning: "油卡余额预警"
};

export const resolveFleetNotificationTitle = (type: FleetNotificationType): string =>
  notificationTitles[type];

export const buildFleetNotificationCard = (input: FleetNotificationCardInput) => ({
  card_type: "text_notice",
  source: {
    desc: "车辆油卡",
    desc_color: 0
  },
  main_title: {
    title: resolveFleetNotificationTitle(input.notification_type),
    desc: `${input.applicant_name} / ${input.application_no}`
  },
  emphasis_content: {
    title: input.amount_text,
    desc: "申请额度"
  },
  sub_title_text: input.risk_summary || "请查看申请详情并处理。",
  jump_list: [
    {
      type: 1,
      title: "打开Web处理",
      url: input.detail_url
    }
  ],
  card_action: {
    type: 1,
    url: input.detail_url
  }
});

const isFleetNotificationType = (value: string): value is FleetNotificationType =>
  Object.prototype.hasOwnProperty.call(notificationTitles, value);

const parseTargetUserIds = (value: string | null): string[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    const userIds = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return [...new Set(userIds)];
  } catch {
    return [];
  }
};

const loadFinanceOfficeTargets = async (env: Env): Promise<string[]> =>
  parseTargetUserIds(await env.KV.get(financeOfficeTargetsKey));

const formatAmount = (value: number | null): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "待补充";
  }

  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const resolveFleetDetailUrl = (env: Env, applicationId: number | null): string => {
  const explicitBase = env.WECOM_APPROVAL_WEB_BASE_URL?.trim();
  const fallback = env.WECHAT_REDIRECT_URI?.trim();
  let base = explicitBase || fallback || "";

  if (base) {
    try {
      const parsed = new URL(base);
      base = parsed.origin;
    } catch {
      base = base.replace(/\/$/, "");
    }
  }

  const path = applicationId
    ? `/finance/fleet/processing?application_id=${encodeURIComponent(String(applicationId))}`
    : "/finance/fleet/processing";

  return base ? `${base.replace(/\/$/, "")}${path}` : path;
};

const loadApplicationCardInput = async (
  env: Env,
  notification: FleetNotificationRow
): Promise<FleetNotificationCardInput> => {
  const notificationType = isFleetNotificationType(notification.notification_type)
    ? notification.notification_type
    : "submitted";
  const fallback = {
    application_no: notification.application_id ? `#${notification.application_id}` : "未关联申请",
    applicant_name: "未知申请人",
    amount_text: "待补充",
    risk_summary: notification.message_summary
  };

  if (!notification.application_id) {
    return {
      notification_type: notificationType,
      ...fallback,
      detail_url: resolveFleetDetailUrl(env, null)
    };
  }

  const application = await env.DB.prepare(
    `SELECT
      id,
      application_no,
      applicant_userid,
      requested_amount,
      risk_summary
     FROM fuel_quota_application
     WHERE id = ?`
  )
    .bind(notification.application_id)
    .first<FuelQuotaApplicationNotificationRow>();

  return {
    notification_type: notificationType,
    application_no: application?.application_no ?? fallback.application_no,
    applicant_name: application?.applicant_userid ?? fallback.applicant_name,
    amount_text: formatAmount(application?.requested_amount ?? null),
    risk_summary: application?.risk_summary?.trim() || notification.message_summary,
    detail_url: resolveFleetDetailUrl(env, notification.application_id)
  };
};

const updateNotificationStatus = async (
  env: Env,
  notificationId: number,
  status: "sent" | "failed" | "skipped",
  values: {
    errorMessage?: string | null;
    incrementRetry?: boolean;
    sentAt?: string | null;
  } = {}
): Promise<void> => {
  const ts = nowIso();
  await env.DB.prepare(
    `UPDATE fleet_wecom_notification
     SET status = ?,
         error_message = ?,
         retry_count = retry_count + ?,
         sent_at = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      status,
      values.errorMessage ?? null,
      values.incrementRetry ? 1 : 0,
      values.sentAt ?? null,
      ts,
      notificationId
    )
    .run();
};

const claimFleetNotification = async (
  env: Env,
  notificationId: number,
  staleBefore: string
): Promise<boolean> => {
  const result = await env.DB.prepare(
    `UPDATE fleet_wecom_notification
     SET status = 'sending',
         error_message = NULL,
         updated_at = ?
     WHERE id = ?
       AND (status = 'pending' OR (status = 'sending' AND updated_at <= ?))`
  )
    .bind(nowIso(), notificationId, staleBefore)
    .run();

  return (result.meta.changes ?? 0) > 0;
};

const assertNoRejectedWeComRecipients = (result: {
  invaliduser: string | null;
  unlicenseduser: string | null;
}): void => {
  const failures = [
    result.invaliduser ? `invaliduser=${result.invaliduser}` : null,
    result.unlicenseduser ? `unlicenseduser=${result.unlicenseduser}` : null
  ].filter((item): item is string => item !== null);

  if (failures.length > 0) {
    throw new Error(`WeCom rejected recipients: ${failures.join("; ")}`);
  }
};

export const deliverPendingFleetNotifications = async (
  env: Env,
  options: DeliverPendingFleetNotificationsOptions = {}
): Promise<DeliverPendingFleetNotificationsResult> => {
  const limit =
    typeof options.limit === "number" && Number.isSafeInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, 100)
      : 20;
  const staleBefore = staleSendingCutoffIso();
  const result: DeliverPendingFleetNotificationsResult = { sent: 0, failed: 0, skipped: 0 };

  let sql = `SELECT
      id,
      application_id,
      notification_type,
      target_userids_json,
      target_group_key,
      message_summary
     FROM fleet_wecom_notification
     WHERE (status = 'pending' OR (status = 'sending' AND updated_at <= ?))`;
  const params: Array<string | number> = [staleBefore];

  if (typeof options.notificationId === "number") {
    sql += " AND id = ?";
    params.push(options.notificationId);
  }

  sql += " ORDER BY id ASC LIMIT ?";
  params.push(typeof options.notificationId === "number" ? 1 : limit);

  const rows = await env.DB.prepare(sql)
    .bind(...params)
    .all<FleetNotificationRow>();

  for (const notification of rows.results ?? []) {
    const claimed = await claimFleetNotification(env, notification.id, staleBefore);
    if (!claimed) {
      continue;
    }

    const explicitTargets = parseTargetUserIds(notification.target_userids_json);
    const targets =
      explicitTargets.length > 0
        ? explicitTargets
        : notification.target_group_key === "finance_office"
          ? await loadFinanceOfficeTargets(env)
          : [];

    if (targets.length === 0) {
      await updateNotificationStatus(env, notification.id, "skipped", {
        errorMessage: "No target users resolved"
      });
      result.skipped += 1;
      continue;
    }

    try {
      const cardInput = await loadApplicationCardInput(env, notification);
      const sendResult = await sendWeComTemplateCard(env, {
        touser: targets.join("|"),
        template_card: buildFleetNotificationCard(cardInput)
      });
      assertNoRejectedWeComRecipients(sendResult);
      await updateNotificationStatus(env, notification.id, "sent", {
        sentAt: nowIso()
      });
      result.sent += 1;
    } catch (error) {
      await updateNotificationStatus(env, notification.id, "failed", {
        errorMessage: error instanceof Error ? error.message : "Failed to deliver fleet notification",
        incrementRetry: true
      });
      result.failed += 1;
    }
  }

  return result;
};

export const createFleetTimeoutNotifications = async (env: Env): Promise<number> => {
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT
      a.id,
      a.application_no
     FROM fuel_quota_application a
     WHERE a.status = 'pending'
       AND a.requested_at <= ?
       AND NOT EXISTS (
         SELECT 1
         FROM fleet_wecom_notification n
         WHERE n.application_id = a.id
           AND n.notification_type = 'timeout'
           AND n.created_at >= ?
       )
     ORDER BY a.requested_at ASC
     LIMIT 50`
  )
    .bind(fourHoursAgo, oneDayAgo)
    .all<{ id: number; application_no: string }>();

  let created = 0;
  for (const application of rows.results ?? []) {
    await createFleetNotificationRecord(env, {
      application_id: application.id,
      notification_type: "timeout",
      target_group_key: "finance_office",
      message_summary: `油卡申请 ${application.application_no} 已超过 4 小时未处理`
    });
    created += 1;
  }

  return created;
};
