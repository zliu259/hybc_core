import { describe, expect, it } from "vitest";

import {
  REPLAY_HEADER,
  assertUsableReplaySecret,
  isUsableReplaySecret,
  sha256Hex,
  signReplayMarker,
  verifyReplayMarker
} from "./agent-replay";
import type { Env } from "../types/env";

const SECRET = "test-replay-secret-long-enough";

describe("sha256Hex", () => {
  it("is stable and differs by content", async () => {
    expect(await sha256Hex("a")).toBe(await sha256Hex("a"));
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });

  it("handles an empty body", async () => {
    expect(await sha256Hex("")).toHaveLength(64);
  });
});

describe("replay marker", () => {
  it("verifies a marker it signed", async () => {
    const bodyHash = await sha256Hex('{"comment":"ok"}');
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker)).toBe(true);
  });

  it("rejects a marker signed with a different secret", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker("other-secret-value", "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker bound to a different pending id", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-2", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker when the body changed", async () => {
    const marker = await signReplayMarker(SECRET, "pending-1", await sha256Hex("{}"));
    const tampered = await sha256Hex('{"comment":"evil"}');
    expect(await verifyReplayMarker(SECRET, "pending-1", tampered, marker)).toBe(false);
  });

  it("rejects garbage, empty and truncated markers without throwing", async () => {
    const bodyHash = await sha256Hex("{}");
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, "")).toBe(false);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, "!!!not-base64!!!")).toBe(false);
    const marker = await signReplayMarker(SECRET, "pending-1", bodyHash);
    expect(await verifyReplayMarker(SECRET, "pending-1", bodyHash, marker.slice(0, 8))).toBe(false);
  });

  it("exposes the header name used to carry the marker", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});

describe("secret usability (fail closed)", () => {
  it("rejects the shipped placeholder and empties outside local", () => {
    expect(isUsableReplaySecret("REPLACE_WITH_PROD_SECRET", "production")).toBe(false);
    expect(isUsableReplaySecret("", "production")).toBe(false);
    expect(isUsableReplaySecret(undefined, "production")).toBe(false);
    expect(isUsableReplaySecret("short", "production")).toBe(false);
  });

  it("accepts a real-looking secret in production", () => {
    expect(isUsableReplaySecret(SECRET, "production")).toBe(true);
  });

  it("still refuses an empty secret even in local (nothing to sign with)", () => {
    expect(isUsableReplaySecret("", "local")).toBe(false);
  });

  it("tolerates a short dev secret in local only", () => {
    expect(isUsableReplaySecret("dev", "local")).toBe(true);
    expect(isUsableReplaySecret("dev", "production")).toBe(false);
  });

  it("assertUsableReplaySecret returns the secret or throws a clear error", () => {
    const good = { AGENT_REPLAY_SECRET: SECRET, APP_ENV: "production" } as unknown as Env;
    expect(assertUsableReplaySecret(good)).toBe(SECRET);
    const bad = {
      AGENT_REPLAY_SECRET: "REPLACE_WITH_PROD_SECRET",
      APP_ENV: "production"
    } as unknown as Env;
    expect(() => assertUsableReplaySecret(bad)).toThrow(/AGENT_REPLAY_SECRET/);
  });
});
