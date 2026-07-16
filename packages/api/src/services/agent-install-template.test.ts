import { describe, expect, it } from "vitest";

import { renderInstallScript } from "./agent-install-template";

const SAMPLE = [
  'HYBC_API="__HYBC_API__"',
  'HYBC_BOOT="__HYBC_BOOT__"',
  'HYBC_AGENT="__HYBC_AGENT__"',
  'curl "__HYBC_API__/api/v1/agent/setup/redeem"'
].join("\n");

describe("renderInstallScript", () => {
  it("substitutes api/boot/agent and strips trailing slash on api", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com/",
      boot: "123e4567-e89b-12d3-a456-426614174000",
      agent: "claude_code"
    });
    expect(out).toContain('HYBC_API="https://api.hybcdg.com"');
    expect(out).toContain('HYBC_BOOT="123e4567-e89b-12d3-a456-426614174000"');
    expect(out).toContain('HYBC_AGENT="claude_code"');
    expect(out).not.toContain("__HYBC_");
  });

  it("rejects a non-UUID boot (empty boot, never injects)", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com",
      boot: 'x"; rm -rf ~ ; "',
      agent: "claude_code"
    });
    expect(out).toContain('HYBC_BOOT=""');
    expect(out).not.toContain("rm -rf");
  });

  it("whitelists agent (unknown -> 'other')", () => {
    const out = renderInstallScript(SAMPLE, {
      apiBase: "https://api.hybcdg.com",
      boot: "123e4567-e89b-12d3-a456-426614174000",
      agent: 'evil"; curl x'
    });
    expect(out).toContain('HYBC_AGENT="other"');
    expect(out).not.toContain("curl x");
  });

  it("accepts the whitelisted agents", () => {
    for (const a of ["claude_code", "codex", "claude_desktop"]) {
      const out = renderInstallScript(SAMPLE, {
        apiBase: "https://api.hybcdg.com",
        boot: "123e4567-e89b-12d3-a456-426614174000",
        agent: a
      });
      expect(out).toContain(`HYBC_AGENT="${a}"`);
    }
  });
});
