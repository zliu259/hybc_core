import type { Env } from "../types/env";

export type FleetFuelRulePolicyType =
  | "amount_limit"
  | "monthly_frequency"
  | "mileage_delta"
  | "card_balance"
  | "photo_required";

export interface FleetFuelRulePolicy {
  id: number;
  policy_name: string;
  policy_type: FleetFuelRulePolicyType;
  config_json: string;
  severity: "info" | "warning" | "high";
  enabled: number;
}

export interface FuelApplicationRuleContext {
  requested_amount: number;
  vehicle_mileage_km: number;
  photo_keys_json: string | null;
  monthly_apply_count: number;
  previous_mileage_km: number | null;
  card_latest_balance: number | null;
}

export interface FuelQuotaRuleHitDraft {
  policy_id: number;
  policy_type: FleetFuelRulePolicyType;
  severity: "info" | "warning" | "high";
  hit_message: string;
  suggested_action: "review" | "verify_balance" | "request_info";
}

export type FuelRiskLevel = "normal" | "warning" | "high";

export type FuelApplicationStatus = "pending" | "needs_info" | "processed" | "rejected" | "cancelled";

export interface FuelRiskSummary {
  risk_level: FuelRiskLevel;
  risk_summary: string;
}

export interface CreateFleetNotificationRecordInput {
  application_id: number | null;
  notification_type: string;
  target_userids_json?: string | null;
  target_group_key?: string | null;
  message_summary: string;
}

interface FuelRuleConfig {
  max_amount?: number;
  max_count?: number;
  max_delta_km?: number;
  min_balance?: number;
  required?: boolean;
}

const nowIso = () => new Date().toISOString();

const allowedFuelApplicationTransitions: Record<FuelApplicationStatus, FuelApplicationStatus[]> = {
  pending: ["processed", "rejected", "needs_info", "cancelled"],
  needs_info: ["pending", "cancelled"],
  processed: [],
  rejected: [],
  cancelled: []
};

export const assertFuelApplicationTransition = (
  from: FuelApplicationStatus,
  to: FuelApplicationStatus
): void => {
  if (!allowedFuelApplicationTransitions[from].includes(to)) {
    throw new Error(`Invalid fuel application status transition: ${from} -> ${to}`);
  }
};

const parseRuleConfig = (configJson: string): FuelRuleConfig | null => {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as FuelRuleConfig;
  } catch {
    return null;
  }
};

const hasRequiredPhoto = (photoKeysJson: string | null): boolean => {
  if (!photoKeysJson) {
    return false;
  }

  try {
    const parsed = JSON.parse(photoKeysJson) as unknown;
    return Array.isArray(parsed) && parsed.some((key) => typeof key === "string" && key.trim() !== "");
  } catch {
    return false;
  }
};

const isRuleHit = (
  policy: FleetFuelRulePolicy,
  application: FuelApplicationRuleContext,
  config: FuelRuleConfig
): boolean => {
  switch (policy.policy_type) {
    case "amount_limit":
      return typeof config.max_amount === "number" && application.requested_amount > config.max_amount;
    case "monthly_frequency":
      return (
        typeof config.max_count === "number" && application.monthly_apply_count > config.max_count
      );
    case "mileage_delta":
      return (
        typeof config.max_delta_km === "number" &&
        application.previous_mileage_km !== null &&
        application.vehicle_mileage_km - application.previous_mileage_km > config.max_delta_km
      );
    case "card_balance":
      return (
        typeof config.min_balance === "number" &&
        application.card_latest_balance !== null &&
        application.card_latest_balance < config.min_balance
      );
    case "photo_required":
      return config.required === true && !hasRequiredPhoto(application.photo_keys_json);
  }
};

const getSuggestedAction = (
  policyType: FleetFuelRulePolicyType
): FuelQuotaRuleHitDraft["suggested_action"] => {
  if (policyType === "card_balance") {
    return "verify_balance";
  }
  if (policyType === "photo_required") {
    return "request_info";
  }

  return "review";
};

export const evaluateFuelApplicationRules = (input: {
  policies: FleetFuelRulePolicy[];
  application: FuelApplicationRuleContext;
}): FuelQuotaRuleHitDraft[] =>
  input.policies.flatMap((policy) => {
    if (policy.enabled !== 1) {
      return [];
    }

    const config = parseRuleConfig(policy.config_json);
    if (!config || !isRuleHit(policy, input.application, config)) {
      return [];
    }

    return [
      {
        policy_id: policy.id,
        policy_type: policy.policy_type,
        severity: policy.severity,
        hit_message: policy.policy_name,
        suggested_action: getSuggestedAction(policy.policy_type)
      }
    ];
  });

export const buildFuelRiskSummary = (hits: FuelQuotaRuleHitDraft[]): FuelRiskSummary => {
  if (hits.length === 0) {
    return {
      risk_level: "normal",
      risk_summary: "未命中风险规则"
    };
  }

  return {
    risk_level: hits.some((hit) => hit.severity === "high") ? "high" : "warning",
    risk_summary: `命中 ${hits.length} 条规则：${hits.map((hit) => hit.hit_message).join("、")}`
  };
};

export const listEnabledFleetFuelRulePolicies = async (env: Env): Promise<FleetFuelRulePolicy[]> => {
  const rows = await env.DB.prepare(
    `SELECT
      id,
      policy_name,
      policy_type,
      config_json,
      severity,
      enabled
     FROM fleet_fuel_rule_policy
     WHERE enabled = ?
     ORDER BY id ASC`
  )
    .bind(1)
    .all<FleetFuelRulePolicy>();

  return rows.results ?? [];
};

export const replaceFuelQuotaRuleHits = async (
  env: Env,
  applicationId: number,
  hits: FuelQuotaRuleHitDraft[]
): Promise<void> => {
  await env.DB.prepare("DELETE FROM fuel_quota_rule_hit WHERE application_id = ?")
    .bind(applicationId)
    .run();

  if (hits.length === 0) {
    return;
  }

  const createdAt = nowIso();
  for (const hit of hits) {
    await env.DB.prepare(
      `INSERT INTO fuel_quota_rule_hit (
        application_id,
        policy_id,
        policy_type,
        severity,
        hit_message,
        suggested_action,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        applicationId,
        hit.policy_id,
        hit.policy_type,
        hit.severity,
        hit.hit_message,
        hit.suggested_action,
        createdAt
      )
      .run();
  }
};

export const createFleetNotificationRecord = async (
  env: Env,
  input: CreateFleetNotificationRecordInput
): Promise<void> => {
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO fleet_wecom_notification (
      application_id,
      notification_type,
      target_userids_json,
      target_group_key,
      message_summary,
      status,
      retry_count,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.application_id,
      input.notification_type,
      input.target_userids_json ?? null,
      input.target_group_key ?? null,
      input.message_summary,
      "pending",
      0,
      ts,
      ts
    )
    .run();
};

export const appendApiAuditLog = async (
  env: Env,
  input: {
    actor_userid: string | null;
    actor_roles_json: string | null;
    action: string;
    target_type: string;
    target_id: string;
    status?: "success" | "failed";
    detail_json?: string | null;
  }
): Promise<void> => {
  await env.DB.prepare(
    `INSERT INTO api_audit_log
      (actor_userid, actor_roles_json, action, target_type, target_id, status, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      input.actor_userid,
      input.actor_roles_json,
      input.action,
      input.target_type,
      input.target_id,
      input.status ?? "success",
      input.detail_json ?? null,
      nowIso()
    )
    .run();
};
