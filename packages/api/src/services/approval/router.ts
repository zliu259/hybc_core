import type { Env } from "../../types/env";
import type {
  ApprovalTemplate,
  ApprovalThreshold,
  RouteContext
} from "../../types/approval";
import { parseTemplate, type ParsedTemplate } from "./template-parser";

// ─── Types ──────────

export interface ResolvedRoute {
  template: ApprovalTemplate;
  branch: string | null;
  parsedTemplate: ParsedTemplate;
}

// ─── Router ──────────

/**
 * Resolve which approval template and branch to use for a given biz_type + context.
 */
export const resolveTemplate = async (
  env: Env,
  bizType: string,
  context: RouteContext
): Promise<ResolvedRoute> => {
  // Find active template for this biz_type
  const template = await env.DB.prepare(
    "SELECT * FROM approval_template WHERE biz_type = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
  )
    .bind(bizType)
    .first<ApprovalTemplate>();

  if (!template) {
    throw new Error(`No active approval template found for biz_type: ${bizType}`);
  }

  // Load thresholds for this template
  const thresholdRows = await env.DB.prepare(
    "SELECT * FROM approval_threshold WHERE template_id = ? AND status = 'active' ORDER BY priority ASC"
  )
    .bind(template.id)
    .all<ApprovalThreshold>();

  const thresholds = thresholdRows.results ?? [];

  // Evaluate thresholds to determine branch
  const branch = evaluateThresholds(thresholds, context);

  // Parse template config
  const parsedTemplate = parseTemplate(template.config_json);

  return { template, branch, parsedTemplate };
};

// ─── Internal ──────────

/**
 * Evaluate threshold rules against context to determine which branch to follow.
 * Returns the target_branch of the first matching threshold, or null for default.
 */
const evaluateThresholds = (
  thresholds: ApprovalThreshold[],
  context: RouteContext
): string | null => {
  for (const threshold of thresholds) {
    const fieldValue = context[threshold.condition_field];
    if (fieldValue === undefined || fieldValue === null) {
      continue;
    }

    const numValue = Number(fieldValue);
    if (Number.isNaN(numValue)) {
      continue;
    }

    let matched = false;

    switch (threshold.operator) {
      case "gt":
        matched = numValue > threshold.threshold_value;
        break;
      case "gte":
        matched = numValue >= threshold.threshold_value;
        break;
      case "lt":
        matched = numValue < threshold.threshold_value;
        break;
      case "lte":
        matched = numValue <= threshold.threshold_value;
        break;
      case "eq":
        matched = numValue === threshold.threshold_value;
        break;
      case "between":
        matched =
          numValue >= threshold.threshold_value &&
          threshold.threshold_value_upper !== null &&
          numValue <= threshold.threshold_value_upper;
        break;
      default:
        matched = false;
    }

    if (matched) {
      return threshold.target_branch;
    }
  }

  return null;
};
