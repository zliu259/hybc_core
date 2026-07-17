import { beforeEach, describe, expect, it } from "vitest";

import { popRedirect, sanitizeRedirect, stashRedirect } from "./loginRedirect";

describe("sanitizeRedirect", () => {
  it("accepts in-app paths with query", () => {
    expect(sanitizeRedirect("/agent/authorize?user_code=ABCD-EFGH")).toBe(
      "/agent/authorize?user_code=ABCD-EFGH"
    );
    expect(sanitizeRedirect("/agent?next=https://x.com")).toBe(
      "/agent?next=https://x.com"
    );
  });

  it("rejects external / protocol-relative urls", () => {
    expect(sanitizeRedirect("https://evil.com/x")).toBeNull();
    expect(sanitizeRedirect("//evil.com/x")).toBeNull();
    expect(sanitizeRedirect("javascript:alert(1)")).toBeNull();
    expect(sanitizeRedirect("/\t/evil.com")).toBeNull();
    expect(sanitizeRedirect("/\\evil.com")).toBeNull();
    expect(sanitizeRedirect("/agent#x")).toBeNull();
  });

  it("rejects non-strings, empty, and the login page itself", () => {
    expect(sanitizeRedirect(undefined)).toBeNull();
    expect(sanitizeRedirect(["/a", "/b"])).toBeNull();
    expect(sanitizeRedirect("")).toBeNull();
    expect(sanitizeRedirect("/login")).toBeNull();
    expect(sanitizeRedirect("/login?redirect=/x")).toBeNull();
    expect(sanitizeRedirect("/login/foo")).toBeNull();
  });
});

describe("stash/pop roundtrip (sessionStorage)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("pops what was stashed exactly once", () => {
    stashRedirect("/agent/authorize?user_code=AB12-CD34");
    expect(popRedirect()).toBe("/agent/authorize?user_code=AB12-CD34");
    expect(popRedirect()).toBeNull();
  });

  it("does not stash invalid values", () => {
    stashRedirect("https://evil.com");
    expect(popRedirect()).toBeNull();
  });

  it("does not clobber an existing stash with an invalid value", () => {
    stashRedirect("/agent/grants");
    stashRedirect(undefined);
    expect(popRedirect()).toBe("/agent/grants");
  });
});
