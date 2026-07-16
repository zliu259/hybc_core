import { describe, expect, it } from "vitest";

import { createFakeD1 } from "../test-support/agent-fakes";
import { createAgentGrant, getGrantById } from "../services/agent-grant";
import { adminRevokeAgentGrant } from "./admin";

describe("admin revoke agent grant (service-level)", () => {
  it("super_admin can revoke any grant", async () => {
    const { db } = createFakeD1();
    const { grant } = await createAgentGrant(db, {
      wecomUserid: "SomeStaff",
      role: "operator"
    });
    await adminRevokeAgentGrant(db, grant.id, "super_admin_user");
    const after = await getGrantById(db, grant.id);
    expect(after?.status).toBe("revoked");
    expect(after?.revoked_by).toBe("super_admin_user");
  });
});
