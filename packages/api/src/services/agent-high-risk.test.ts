import { describe, expect, it } from "vitest";

import { isHighRiskEnabled, matchHighRisk } from "./agent-high-risk";
import { createFakeKV } from "../test-support/agent-fakes";
import type { Env } from "../types/env";

describe("matchHighRisk", () => {
  it("matches approval approve/reject with action kind", () => {
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve")).toMatchObject({
      actionKind: "approval.approve"
    });
    expect(matchHighRisk("POST", "/api/v1/approval/7/reject")).toMatchObject({
      actionKind: "approval.reject"
    });
  });

  it("matches without the /api/v1 prefix and ignores query strings", () => {
    expect(matchHighRisk("POST", "/approval/42/approve")).not.toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve?x=1")).not.toBeNull();
  });

  it("does not match reads, other writes, or near-miss paths", () => {
    expect(matchHighRisk("GET", "/api/v1/approval/42")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/transfer")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/payment")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/abc/approve")).toBeNull();
    expect(matchHighRisk("POST", "/api/v1/approval/42/approve/extra")).toBeNull();
  });

  it("is method sensitive", () => {
    expect(matchHighRisk("GET", "/api/v1/approval/42/approve")).toBeNull();
  });
});

const envWith = (kv: KVNamespace, appEnv: string): Env =>
  ({ KV: kv, APP_ENV: appEnv }) as unknown as Env;

describe("isHighRiskEnabled", () => {
  it("defaults to enabled only in local when the KV key is absent", async () => {
    const { kv } = createFakeKV();
    expect(await isHighRiskEnabled(envWith(kv, "local"))).toBe(true);
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
  });

  it("honours an explicit enabled flag", async () => {
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: true }));
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(true);
  });

  it("can force-disable even in local", async () => {
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: false }));
    expect(await isHighRiskEnabled(envWith(kv, "local"))).toBe(false);
  });

  it("treats anything but a literal true as disabled, and malformed JSON as disabled", async () => {
    const { kv } = createFakeKV();
    await kv.put("agent:highrisk:config", JSON.stringify({ enabled: "yes" }));
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
    await kv.put("agent:highrisk:config", "{not json");
    expect(await isHighRiskEnabled(envWith(kv, "production"))).toBe(false);
  });
});
