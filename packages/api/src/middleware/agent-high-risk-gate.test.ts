import { describe, expect, it } from "vitest";

import { decideAgentRequest } from "./agent-high-risk-gate";
import { createFakeKV } from "../test-support/agent-fakes";
import { REPLAY_HEADER, sha256Hex } from "../services/agent-replay";
import type { Env } from "../types/env";

const SECRET = "p2a-test-replay-secret-32-chars-min!!";

const envWith = async (opts: { enabled: boolean }): Promise<Env> => {
  const { kv } = createFakeKV();
  await kv.put("agent:highrisk:config", JSON.stringify({ enabled: opts.enabled }));
  return { KV: kv, APP_ENV: "production", AGENT_REPLAY_SECRET: SECRET } as unknown as Env;
};

/** 用真实签名函数造标记（不复制实现，避免测试与实现同错） */
const realMarker = async (env: Env, pendingId: string, body: string) => {
  const { signReplayMarker } = await import("../services/agent-replay");
  return signReplayMarker(env, pendingId, await sha256Hex(body));
};

describe("decideAgentRequest · reads", () => {
  it("allows an allowlisted read", async () => {
    const env = await envWith({ enabled: true });
    expect((await decideAgentRequest(env, "GET", "/api/v1/project", "", null)).kind).toBe("allow");
  });

  it("allows the pending-status read used by the MCP poller", async () => {
    const env = await envWith({ enabled: true });
    const d = await decideAgentRequest(
      env, "GET", "/api/v1/agent/pending/123e4567-e89b-12d3-a456-426614174000", "", null
    );
    expect(d.kind).toBe("allow");
  });

  it("forbids a mutating GET that is not on the read allowlist", async () => {
    const env = await envWith({ enabled: true });
    expect(
      (await decideAgentRequest(env, "GET", "/api/v1/reimbursement/1/ocr-status", "", null)).kind
    ).toBe("forbid");
  });
});

describe("decideAgentRequest · high-risk writes", () => {
  it("parks a high-risk write when the flag is on", async () => {
    const env = await envWith({ enabled: true });
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", '{"comment":"ok"}', null);
    expect(d.kind).toBe("park");
    if (d.kind === "park") expect(d.rule.actionKind).toBe("approval.approve");
  });

  it("forbids a high-risk write when the flag is off", async () => {
    const env = await envWith({ enabled: false });
    expect(
      (await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", "{}", null)).kind
    ).toBe("forbid");
  });

  it("forbids writes that are not on the high-risk table at all", async () => {
    const env = await envWith({ enabled: true });
    expect((await decideAgentRequest(env, "POST", "/api/v1/payment", "{}", null)).kind).toBe("forbid");
    expect(
      (await decideAgentRequest(env, "POST", "/api/v1/approval/42/transfer", "{}", null)).kind
    ).toBe("forbid");
  });
});

describe("decideAgentRequest · replay", () => {
  it("allows a high-risk write carrying a valid marker", async () => {
    const env = await envWith({ enabled: true });
    const body = '{"comment":"ok"}';
    const marker = await realMarker(env, "pending-1", body);
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-1", marker
    });
    expect(d.kind).toBe("replay");
    if (d.kind === "replay") expect(d.pendingId).toBe("pending-1");
  });

  it("replays even when the flag is OFF (a confirmed action must not be lost mid-flight)", async () => {
    const env = await envWith({ enabled: false });
    const body = "{}";
    const marker = await realMarker(env, "pending-1", body);
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-1", marker
    });
    expect(d.kind).toBe("replay");
  });

  it("degrades to park (never allow) when the marker is forged", async () => {
    const env = await envWith({ enabled: true });
    const body = '{"comment":"ok"}';
    const forgedEnv = { ...env, AGENT_REPLAY_SECRET: "attacker-secret-32-chars-minimum!!!" } as Env;
    const forged = await realMarker(forgedEnv, "pending-1", body);
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-1", marker: forged
    });
    expect(d.kind).toBe("park");
  });

  it("degrades to park when the body was tampered after signing", async () => {
    const env = await envWith({ enabled: true });
    const marker = await realMarker(env, "pending-1", '{"comment":"ok"}');
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", '{"comment":"evil"}', {
      pendingId: "pending-1", marker
    });
    expect(d.kind).toBe("park");
  });

  it("degrades to park when the marker belongs to a different pending action", async () => {
    const env = await envWith({ enabled: true });
    const body = "{}";
    const marker = await realMarker(env, "pending-1", body);
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", body, {
      pendingId: "pending-2", marker
    });
    expect(d.kind).toBe("park");
  });

  it("ignores a marker on a path that is not high-risk (still forbid, never allow)", async () => {
    const env = await envWith({ enabled: true });
    const body = "{}";
    const marker = await realMarker(env, "pending-1", body);
    const d = await decideAgentRequest(env, "POST", "/api/v1/payment", body, {
      pendingId: "pending-1", marker
    });
    expect(d.kind).toBe("forbid");
  });

  it("a bare header with no marker value cannot unlock replay", async () => {
    const env = await envWith({ enabled: true });
    const d = await decideAgentRequest(env, "POST", "/api/v1/approval/42/approve", "{}", {
      pendingId: "pending-1", marker: ""
    });
    expect(d.kind).toBe("park");
  });

  it("exposes the header name used to carry the marker", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});
