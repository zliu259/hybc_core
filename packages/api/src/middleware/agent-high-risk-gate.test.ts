import { describe, expect, it } from "vitest";

import { decideAgentRequest } from "./agent-high-risk-gate";
import { isAllowedAgentRead } from "./agent-readonly";
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

describe("pending 路径形状：必须是真 UUID", () => {
  const pendingPath = (id: string) => `/api/v1/agent/pending/${id}`;

  it("accepts an id actually produced by crypto.randomUUID()", () => {
    // 用真实生成的 id 而非手写字面量：手写的 UUID 可能恰好绕开版本/变体位的差异，
    // 而这里要保证的是「运行时真正会出现的 id 一定通过」。多取几个，避免偶然。
    for (let i = 0; i < 20; i += 1) {
      const id = crypto.randomUUID();
      expect(isAllowedAgentRead("GET", pendingPath(id)), `randomUUID ${id}`).toBe(true);
    }
  });

  it("rejects 36-char strings that are not UUID-shaped", () => {
    expect(isAllowedAgentRead("GET", pendingPath("-".repeat(36))), "36 dashes").toBe(false);
    expect(isAllowedAgentRead("GET", pendingPath("a".repeat(36))), "36 a's").toBe(false);
  });

  it("rejects wrong segment lengths even when the total length is right", () => {
    // 36 字符，但分段是 7-5-4-4-12（第一段少一位、第二段多一位）。
    expect(
      isAllowedAgentRead("GET", pendingPath("123e456-7e89b-12d3-a456-426614174000")),
      "wrong segment lengths"
    ).toBe(false);
  });

  it("still rejects traversal and non-GET on the pending path", () => {
    expect(isAllowedAgentRead("GET", pendingPath("../../secret"))).toBe(false);
    expect(isAllowedAgentRead("POST", pendingPath(crypto.randomUUID()))).toBe(false);
  });
});

/**
 * deny-by-default 不变量扫描。
 *
 * 上面的用例是「举例式」的：每条钉住一个已知场景。本块换一个角度——枚举方法 × 路径 ×
 * 无效标记 × 开关，断言两条【全局】不变量恒成立。它防的是未来某次改动（改闸门顺序、
 * 往任一白名单加条目、给标记校验加“快捷路径”）在没人写对应用例的维度上悄悄破防：
 * 举例式用例只覆盖它自己那一格，扫描覆盖整个网格。
 *
 * 不变量 a：伪造/缺失/垃圾标记【绝不】产生 replay —— 执行权只能由有效 HMAC 解锁。
 * 不变量 b：allow 只出现在 isAllowedAgentRead 独立为真处 —— 写路径永远拿不到 allow，
 *          且标记的存在与否不能影响 allow 的判定。
 *
 * 矩阵刻意保持精简（跑得快才会有人留着它）：密钥可用性 / APP_ENV 这两个维度由上面的
 * 聚焦用例覆盖，此处固定一个可用密钥，不做无谓交叉。
 */
describe("deny-by-default invariant sweep", () => {
  const SWEEP_BODY = '{"comment":"ok"}';
  const SWEEP_PENDING = "sweep-pending";

  const METHODS = ["GET", "POST", "PUT", "DELETE", "post"] as const;

  const PATHS = [
    "/api/v1/project", // 白名单读
    "/project", // 白名单读（相对形态）
    `/api/v1/agent/pending/${crypto.randomUUID()}`, // 白名单读（P2a 轮询）
    "/api/v1/reimbursement/1/ocr-status", // mutating GET，不在白名单
    "/api/v1/approval/42/approve", // 高危写
    "/api/v1/approval/42/reject", // 高危写
    "/api/v1/approval/42/approve?x=1", // 高危写 + query
    "/api/v1/payment", // 普通写，不在高危表
    "/api/v1/approval/42/transfer", // 普通写，不在高危表
    "/api/v1/agent/pending/../../secret", // 穿越形态
    `/api/v1/agent/pending/${"-".repeat(36)}` // 非 UUID 的 36 字符
  ] as const;

  it("never yields replay for a bad marker, and yields allow only for allowlisted reads", async () => {
    const enabledEnv = await envWith({ enabled: true });
    const disabledEnv = await envWith({ enabled: false });

    // 四种【无效】标记。注意每一种对 (SWEEP_PENDING, SWEEP_BODY) 这一组合都必须是无效的，
    // 否则不变量 a 会因为标记本就合法而“失败”，那是测试搭错而非实现破防。
    const wrongPendingMarker = await realMarker(enabledEnv, "some-other-pending", SWEEP_BODY);
    const wrongBodyMarker = await realMarker(enabledEnv, SWEEP_PENDING, '{"comment":"evil"}');
    const markerVariants: { label: string; replay: { pendingId: string; marker: string } | null }[] =
      [
        { label: "absent", replay: null },
        { label: "empty", replay: { pendingId: SWEEP_PENDING, marker: "" } },
        { label: "garbage", replay: { pendingId: SWEEP_PENDING, marker: "not-a-real-marker" } },
        {
          label: "valid-but-wrong-pending",
          replay: { pendingId: SWEEP_PENDING, marker: wrongPendingMarker }
        },
        {
          label: "valid-but-wrong-body",
          replay: { pendingId: SWEEP_PENDING, marker: wrongBodyMarker }
        }
      ];

    let combinations = 0;
    for (const [flagLabel, env] of [
      ["flag=on", enabledEnv],
      ["flag=off", disabledEnv]
    ] as const) {
      for (const method of METHODS) {
        for (const path of PATHS) {
          for (const variant of markerVariants) {
            combinations += 1;
            const tag = `${method} ${path} marker=${variant.label} ${flagLabel}`;
            const decision = await decideAgentRequest(env, method, path, SWEEP_BODY, variant.replay);

            // a：无效标记绝不解锁执行。
            expect(decision.kind, `invariant a violated → replay granted for ${tag}`).not.toBe(
              "replay"
            );

            // b：allow 只跟只读白名单走，与标记无关。
            if (decision.kind === "allow") {
              expect(
                isAllowedAgentRead(method, path),
                `invariant b violated → allow for non-allowlisted ${tag}`
              ).toBe(true);
            }
          }
        }
      }
    }

    // 守住矩阵规模本身：若有人删掉一个维度导致扫描名存实亡，这里会失败。
    expect(combinations).toBe(2 * METHODS.length * PATHS.length * markerVariants.length);
  });
});
