import type { AuthTokenPayload } from "../types/auth";

export type WarehouseEvidenceAccessContext = {
  assignee_userid: string | null;
  operator_userid: string | null;
  warehouse_manager_userid: string | null;
};

export const canAccessWarehouseTaskEvidence = (
  auth: AuthTokenPayload,
  context: WarehouseEvidenceAccessContext
): boolean => {
  if (auth.roles.includes("super_admin")) return true;
  if (context.warehouse_manager_userid && context.warehouse_manager_userid === auth.sub) {
    return true;
  }
  if (context.assignee_userid && context.assignee_userid === auth.sub) return true;
  if (context.operator_userid && context.operator_userid === auth.sub) return true;
  return false;
};
