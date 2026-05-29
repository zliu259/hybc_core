import { describe, expect, it } from "vitest";

import { canListExternalLogReviewProjects, canReviewExternalLogSubmission } from "./project";

describe("canReviewExternalLogSubmission", () => {
  it("allows super admin regardless of project manager", () => {
    expect(
      canReviewExternalLogSubmission({
        userid: "root",
        roles: ["super_admin"],
        projectManagerUserid: "manager-a"
      })
    ).toBe(true);
  });

  it("allows the project manager with a management role", () => {
    expect(
      canReviewExternalLogSubmission({
        userid: "manager-a",
        roles: ["site_manager"],
        projectManagerUserid: "manager-a"
      })
    ).toBe(true);
  });

  it("rejects unrelated managers", () => {
    expect(
      canReviewExternalLogSubmission({
        userid: "manager-b",
        roles: ["manager"],
        projectManagerUserid: "manager-a"
      })
    ).toBe(false);
  });

  it("rejects operators even if they match the project manager userid", () => {
    expect(
      canReviewExternalLogSubmission({
        userid: "manager-a",
        roles: ["operator"],
        projectManagerUserid: "manager-a"
      })
    ).toBe(false);
  });
});

describe("canListExternalLogReviewProjects", () => {
  it("allows super admin to see every project", () => {
    expect(canListExternalLogReviewProjects({ userid: "root", roles: ["super_admin"] })).toBe(
      "all"
    );
  });

  it("limits project managers to projects they manage", () => {
    expect(canListExternalLogReviewProjects({ userid: "manager-a", roles: ["manager"] })).toBe(
      "managed"
    );
    expect(
      canListExternalLogReviewProjects({ userid: "site-manager-a", roles: ["site_manager"] })
    ).toBe("managed");
  });

  it("rejects non-management roles from the global review list", () => {
    expect(canListExternalLogReviewProjects({ userid: "operator-a", roles: ["operator"] })).toBe(
      "none"
    );
  });
});
