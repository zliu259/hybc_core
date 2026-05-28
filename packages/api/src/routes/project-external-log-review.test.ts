import { describe, expect, it } from "vitest";

import { canReviewExternalLogSubmission } from "./project";

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
