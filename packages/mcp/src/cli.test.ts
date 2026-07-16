import { describe, expect, it, vi } from "vitest";

import { runCli, type CliDeps } from "./cli";

const baseDeps = (over: Partial<CliDeps> = {}): CliDeps => ({
  readCredentials: vi.fn(async () => null),
  saveCredentials: vi.fn(async () => undefined),
  clearCredentials: vi.fn(async () => undefined),
  runLogin: vi.fn(async () => ({
    token: "hybc_agent_x",
    wecomUserid: "MaxLiu",
    role: "finance"
  })),
  serve: vi.fn(async () => undefined),
  now: () => "2026-07-16T00:00:00.000Z",
  log: vi.fn(),
  ...over
});

describe("runCli", () => {
  it("login runs device flow and saves credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["login"], deps);
    expect(code).toBe(0);
    expect(deps.runLogin).toHaveBeenCalled();
    expect(deps.saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ token: "hybc_agent_x", wecomUserid: "MaxLiu" })
    );
  });

  it("logout clears credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["logout"], deps);
    expect(code).toBe(0);
    expect(deps.clearCredentials).toHaveBeenCalled();
  });

  it("whoami reports not-logged-in as exit 1", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli(["whoami"], deps);
    expect(code).toBe(1);
  });

  it("whoami with credentials reports identity and exits 0", async () => {
    const log = vi.fn();
    const deps = baseDeps({
      readCredentials: vi.fn(async () => ({
        baseUrl: "https://api.hybcdg.com",
        token: "hybc_agent_x",
        wecomUserid: "MaxLiu",
        role: "finance",
        savedAt: "s"
      })),
      log
    });
    const code = await runCli(["whoami"], deps);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("MaxLiu"));
  });

  it("serve without credentials exits 1 and does not start server", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli([], deps);
    expect(code).toBe(1);
    expect(deps.serve).not.toHaveBeenCalled();
  });

  it("serve with credentials starts the server", async () => {
    const deps = baseDeps({
      readCredentials: vi.fn(async () => ({
        baseUrl: "https://api.hybcdg.com",
        token: "hybc_agent_x",
        wecomUserid: "MaxLiu",
        role: "finance",
        savedAt: "s"
      }))
    });
    const code = await runCli(["serve"], deps);
    expect(code).toBe(0);
    expect(deps.serve).toHaveBeenCalledWith("https://api.hybcdg.com", "hybc_agent_x");
  });
});
