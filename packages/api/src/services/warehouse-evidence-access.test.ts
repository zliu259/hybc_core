import { describe, expect, it } from "vitest";

import { canAccessWarehouseTaskEvidence } from "./warehouse-evidence-access";
import type { AuthTokenPayload } from "../types/auth";

const auth = (sub: string, roles: AuthTokenPayload["roles"]): AuthTokenPayload =>
  ({
    sub,
    roles,
    username: sub,
    nickname: sub,
    avatar: "",
    permissions: [],
    tokenId: `${sub}-token`,
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-05-05T00:00:00.000Z",
    exp: 1,
    iat: 1
  }) as AuthTokenPayload;

describe("warehouse evidence access", () => {
  it("allows super admin and warehouse manager to access task evidence", () => {
    const context = {
      assignee_userid: "operator-a",
      operator_userid: "operator-b",
      warehouse_manager_userid: "warehouse-manager"
    };

    expect(canAccessWarehouseTaskEvidence(auth("root", ["super_admin"]), context)).toBe(true);
    expect(canAccessWarehouseTaskEvidence(auth("warehouse-manager", ["manager"]), context)).toBe(
      true
    );
  });

  it("allows only assigned or submitting operators without manager authority", () => {
    const context = {
      assignee_userid: "operator-a",
      operator_userid: "operator-b",
      warehouse_manager_userid: "warehouse-manager"
    };

    expect(canAccessWarehouseTaskEvidence(auth("operator-a", ["operator"]), context)).toBe(true);
    expect(canAccessWarehouseTaskEvidence(auth("operator-b", ["operator"]), context)).toBe(true);
    expect(canAccessWarehouseTaskEvidence(auth("operator-c", ["operator"]), context)).toBe(false);
    expect(canAccessWarehouseTaskEvidence(auth("site-user", ["site_manager"]), context)).toBe(
      false
    );
  });
});
