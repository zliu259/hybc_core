import { describe, expect, it } from "vitest";

import {
  AGENT_TOKEN_PREFIX,
  generateAgentToken,
  hashAgentToken,
  isAgentToken,
  tokenPrefixForDisplay
} from "./agent-token";

describe("agent-token", () => {
  it("generates opaque tokens with the agent prefix", () => {
    const token = generateAgentToken();
    expect(token.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(AGENT_TOKEN_PREFIX.length + 20);
    expect(generateAgentToken()).not.toBe(token);
    expect(token.slice(AGENT_TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("recognizes agent tokens by prefix", () => {
    expect(isAgentToken(generateAgentToken())).toBe(true);
    expect(isAgentToken("eyJhbGciOi.jwt.token")).toBe(false);
  });

  it("hashes deterministically to 64-char hex", async () => {
    const token = generateAgentToken();
    const h1 = await hashAgentToken(token);
    const h2 = await hashAgentToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAgentToken(generateAgentToken())).not.toBe(h1);
  });

  it("exposes only a short display prefix", () => {
    const token = generateAgentToken();
    const prefix = tokenPrefixForDisplay(token);
    expect(token.startsWith(prefix.replace(/…$/, ""))).toBe(true);
    expect(prefix.length).toBeLessThan(token.length);
  });
});
