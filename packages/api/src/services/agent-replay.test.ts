import { describe, expect, it } from "vitest";

import {
  REPLAY_HEADER,
  assertUsableReplaySecret,
  isUsableReplaySecret,
  sha256Hex,
  signReplayMarker,
  verifyReplayMarker,
  type ReplayMarkerParams
} from "./agent-replay";
import type { Env } from "../types/env";

/** 32+ 字符、字符种类充足的测试密钥（满足非 local 环境的强度要求）。 */
const SECRET = "test-replay-secret-long-enough-0123456789";
const PLACEHOLDER = "REPLACE_WITH_PROD_SECRET";

const envWith = (secret: string, appEnv = "production"): Env =>
  ({ AGENT_REPLAY_SECRET: secret, APP_ENV: appEnv }) as unknown as Env;

const PROD_ENV = envWith(SECRET);

const PATH = "/api/v1/approval/7/approve";

/** 标记参数的基线，配合 override 表达「只有这一项不同」。 */
const params = (over: Partial<ReplayMarkerParams> = {}): ReplayMarkerParams => ({
  method: "POST",
  path: PATH,
  pendingId: "pending-1",
  bodyHash: "0".repeat(64),
  ...over
});

/**
 * 攻击者视角：仓库里公开的占位密钥人人可读，攻击者可以自己算 HMAC。
 * 这里绕开本模块、直接用 Web Crypto 复刻签名，用来证明「占位密钥签出的标记必须不被接受」。
 */
const forgeMarkerOutOfBand = async (
  secret: string,
  p: ReplayMarkerParams
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${p.method}:${p.path}:${p.pendingId}:${p.bodyHash}`)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

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
    const p = params({ bodyHash: await sha256Hex('{"comment":"ok"}') });
    expect(await verifyReplayMarker(PROD_ENV, p, await signReplayMarker(PROD_ENV, p))).toBe(true);
  });

  it("rejects a marker signed with a different secret", async () => {
    const p = params();
    const marker = await signReplayMarker(
      envWith("other-secret-value-that-is-long-enough-0123"),
      p
    );
    expect(await verifyReplayMarker(PROD_ENV, p, marker)).toBe(false);
  });

  it("rejects a marker bound to a different pending id", async () => {
    const marker = await signReplayMarker(PROD_ENV, params());
    expect(await verifyReplayMarker(PROD_ENV, params({ pendingId: "pending-2" }), marker)).toBe(
      false
    );
  });

  it("rejects a marker when the body changed", async () => {
    const marker = await signReplayMarker(PROD_ENV, params({ bodyHash: await sha256Hex("{}") }));
    const tampered = await sha256Hex('{"comment":"evil"}');
    expect(await verifyReplayMarker(PROD_ENV, params({ bodyHash: tampered }), marker)).toBe(false);
  });

  /**
   * 纵深防御：标记必须钉死「哪个动作」。此前载荷只含 (pendingId, bodyHash)，
   * 于是同一枚标记在【另一张审批单】和【另一个动词】上都验得过 —— 一旦标记以任何方式外泄
   * （日志、异常栈、将来某个把它落库的改动），它就是一把能改写动作对象的万能钥匙。
   * 今天不可利用（标记只在进程内产生），但「恰好只在一处使用」不是安全性质，绑定才是。
   */
  it("rejects a marker replayed against a different path", async () => {
    const marker = await signReplayMarker(PROD_ENV, params());
    expect(
      await verifyReplayMarker(PROD_ENV, params({ path: "/api/v1/approval/8/approve" }), marker)
    ).toBe(false);
  });

  it("rejects a marker replayed with a different method", async () => {
    const marker = await signReplayMarker(PROD_ENV, params());
    expect(await verifyReplayMarker(PROD_ENV, params({ method: "DELETE" }), marker)).toBe(false);
  });

  it("rejects approve-vs-reject swapping on the same pending action", async () => {
    // 最直接的攻击形态：拿「拒绝 #7」的标记去放行「批准 #7」。
    const marker = await signReplayMarker(
      PROD_ENV,
      params({ path: "/api/v1/approval/7/reject" })
    );
    expect(
      await verifyReplayMarker(PROD_ENV, params({ path: "/api/v1/approval/7/approve" }), marker)
    ).toBe(false);
  });

  it("treats the method case-insensitively (both sides normalize to upper)", async () => {
    const marker = await signReplayMarker(PROD_ENV, params({ method: "post" }));
    expect(await verifyReplayMarker(PROD_ENV, params({ method: "POST" }), marker)).toBe(true);
  });

  /**
   * 签名方从快照取路径、验签方从 c.req.path 取路径，后者【永远不含】query。
   * 故载荷构造器统一剥掉 query：两侧即使一方多带了 query 也必然归一到同一条载荷。
   */
  it("normalizes away a query string on both sides", async () => {
    const marker = await signReplayMarker(PROD_ENV, params({ path: `${PATH}?dry=0` }));
    expect(await verifyReplayMarker(PROD_ENV, params({ path: PATH }), marker)).toBe(true);
  });

  it("rejects garbage, empty and truncated markers without throwing", async () => {
    const p = params();
    expect(await verifyReplayMarker(PROD_ENV, p, "")).toBe(false);
    expect(await verifyReplayMarker(PROD_ENV, p, "!!!not-base64!!!")).toBe(false);
    const marker = await signReplayMarker(PROD_ENV, p);
    expect(await verifyReplayMarker(PROD_ENV, p, marker.slice(0, 8))).toBe(false);
  });

  it("exposes the header name used to carry the marker", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});

describe("guard is mandatory, not advisory (regression: unusable secret must not sign or verify)", () => {
  it("refuses to sign with the placeholder secret", async () => {
    await expect(signReplayMarker(envWith(PLACEHOLDER), params())).rejects.toThrow(
      /AGENT_REPLAY_SECRET/
    );
  });

  it("rejects a marker forged with the publicly-committed placeholder", async () => {
    const forged = await forgeMarkerOutOfBand(PLACEHOLDER, params());
    // 攻击者用占位密钥算出的标记，服务端即使配的就是占位密钥也必须拒绝（fail closed）。
    expect(await verifyReplayMarker(envWith(PLACEHOLDER), params(), forged)).toBe(false);
  });

  it("returns false (never throws) when the configured secret is weak or missing", async () => {
    const forged = await forgeMarkerOutOfBand("short", params());
    expect(await verifyReplayMarker(envWith("short"), params(), forged)).toBe(false);
    expect(await verifyReplayMarker(envWith(""), params(), forged)).toBe(false);
  });
});

describe("payload invariants (delimiter must stay unambiguous)", () => {
  it("rejects a bodyHash that is not 64 lowercase hex chars", async () => {
    await expect(signReplayMarker(PROD_ENV, params({ bodyHash: "y:z" }))).rejects.toThrow(
      /bodyHash/
    );
    await expect(signReplayMarker(PROD_ENV, params({ bodyHash: "" }))).rejects.toThrow(/bodyHash/);
    await expect(
      signReplayMarker(PROD_ENV, params({ bodyHash: "A".repeat(64) }))
    ).rejects.toThrow(/bodyHash/);
    await expect(
      signReplayMarker(PROD_ENV, params({ bodyHash: undefined as unknown as string }))
    ).rejects.toThrow(/bodyHash/);
  });

  it("rejects a pendingId that is empty or contains the delimiter", async () => {
    await expect(signReplayMarker(PROD_ENV, params({ pendingId: "" }))).rejects.toThrow(
      /pendingId/
    );
    await expect(signReplayMarker(PROD_ENV, params({ pendingId: "pending:1" }))).rejects.toThrow(
      /pendingId/
    );
    await expect(
      signReplayMarker(PROD_ENV, params({ pendingId: undefined as unknown as string }))
    ).rejects.toThrow(/pendingId/);
  });

  it("rejects a method that is not purely alphabetic", async () => {
    // method 必须无冒号且非空，否则「取第一个冒号之前」的解析就不再唯一。
    await expect(signReplayMarker(PROD_ENV, params({ method: "PO:ST" }))).rejects.toThrow(/method/);
    await expect(signReplayMarker(PROD_ENV, params({ method: "" }))).rejects.toThrow(/method/);
    await expect(
      signReplayMarker(PROD_ENV, params({ method: undefined as unknown as string }))
    ).rejects.toThrow(/method/);
  });

  it("rejects a path that is not absolute", async () => {
    await expect(signReplayMarker(PROD_ENV, params({ path: "approval/7" }))).rejects.toThrow(
      /path/
    );
    await expect(signReplayMarker(PROD_ENV, params({ path: "" }))).rejects.toThrow(/path/);
    await expect(
      signReplayMarker(PROD_ENV, params({ path: undefined as unknown as string }))
    ).rejects.toThrow(/path/);
  });

  /**
   * 四段载荷 `METHOD:path:pendingId:bodyHash` 的无歧义性证明（path 允许含冒号）：
   * method 无冒号且非空 → 第一个冒号之前唯一确定 method；
   * bodyHash 定长 64 且无冒号 → 末尾 64 字符唯一确定 bodyHash；
   * pendingId 无冒号 → 倒数第二段唯一确定 pendingId；剩下的中间部分即 path。
   * 解析确定且可逆，故不存在两组不同入参映射到同一条载荷。
   */
  it("closes split ambiguity across all four components", async () => {
    await expect(signReplayMarker(PROD_ENV, params({ pendingId: "x", bodyHash: "y:z" })))
      .rejects.toThrow();
    await expect(signReplayMarker(PROD_ENV, params({ pendingId: "x:y", bodyHash: "z" })))
      .rejects.toThrow();

    // path 含冒号是合法的，且不会与相邻段串味：冒号在 path 内不构成解析歧义。
    const colonPath = await signReplayMarker(PROD_ENV, params({ path: "/api/v1/a:b/7/approve" }));
    expect(
      await verifyReplayMarker(PROD_ENV, params({ path: "/api/v1/a:b/7/approve" }), colonPath)
    ).toBe(true);
    expect(
      await verifyReplayMarker(PROD_ENV, params({ path: "/api/v1/a:b/7/reject" }), colonPath)
    ).toBe(false);
  });

  it("verifyReplayMarker returns false rather than throwing on invalid payload parts", async () => {
    expect(await verifyReplayMarker(PROD_ENV, params({ bodyHash: "y:z" }), "whatever")).toBe(false);
    expect(await verifyReplayMarker(PROD_ENV, params({ pendingId: "" }), "whatever")).toBe(false);
    expect(await verifyReplayMarker(PROD_ENV, params({ method: "" }), "whatever")).toBe(false);
    expect(
      await verifyReplayMarker(
        PROD_ENV,
        params({
          pendingId: undefined as unknown as string,
          bodyHash: undefined as unknown as string
        }),
        "whatever"
      )
    ).toBe(false);
  });
});

describe("secret usability (fail closed)", () => {
  it("rejects the shipped placeholder and empties outside local", () => {
    expect(isUsableReplaySecret(PLACEHOLDER, "production")).toBe(false);
    expect(isUsableReplaySecret("", "production")).toBe(false);
    expect(isUsableReplaySecret(undefined, "production")).toBe(false);
    expect(isUsableReplaySecret("short", "production")).toBe(false);
  });

  it("rejects placeholder drift (whitespace, case, suffix)", () => {
    expect(isUsableReplaySecret("REPLACE_WITH_PROD_SECRET\n", "production")).toBe(false);
    expect(isUsableReplaySecret(" REPLACE_WITH_PROD_SECRET", "production")).toBe(false);
    expect(isUsableReplaySecret("replace_with_prod_secret", "production")).toBe(false);
    expect(isUsableReplaySecret("REPLACE_WITH_PROD_SECRET!", "production")).toBe(false);
  });

  it("rejects drifted placeholders in local too", () => {
    expect(isUsableReplaySecret("REPLACE_WITH_PROD_SECRET\n", "local")).toBe(false);
    expect(isUsableReplaySecret("replace_with_prod_secret", "local")).toBe(false);
  });

  it("rejects other well-known placeholder words", () => {
    expect(isUsableReplaySecret("my-placeholder-secret-value-0123456789", "production")).toBe(
      false
    );
    expect(isUsableReplaySecret("CHANGEME-CHANGEME-CHANGEME-CHANGEME", "production")).toBe(false);
  });

  it("requires at least 32 chars outside local", () => {
    expect(isUsableReplaySecret("abcdefghijklmnop-0123456789", "production")).toBe(false);
    expect(isUsableReplaySecret("abcdefghijklmnop-0123456789012345", "production")).toBe(true);
  });

  it("rejects all-whitespace and low-entropy secrets outside local", () => {
    expect(isUsableReplaySecret(" ".repeat(40), "production")).toBe(false);
    expect(isUsableReplaySecret("a".repeat(40), "production")).toBe(false);
    expect(isUsableReplaySecret("abcdabcdabcdabcdabcdabcdabcdabcdabcd", "production")).toBe(false);
    expect(isUsableReplaySecret("abcdefghabcdefghabcdefghabcdefghabcd", "production")).toBe(true);
  });

  it("accepts a real-looking secret in production", () => {
    expect(isUsableReplaySecret(SECRET, "production")).toBe(true);
  });

  it("still refuses an empty or whitespace-only secret even in local", () => {
    expect(isUsableReplaySecret("", "local")).toBe(false);
    expect(isUsableReplaySecret("   ", "local")).toBe(false);
  });

  it("tolerates a short, low-entropy dev secret in local only", () => {
    expect(isUsableReplaySecret("dev", "local")).toBe(true);
    expect(isUsableReplaySecret("dev", "production")).toBe(false);
    expect(isUsableReplaySecret("aaaa", "local")).toBe(true);
  });

  it("treats an undefined APP_ENV as non-local (strict)", () => {
    expect(isUsableReplaySecret("dev", undefined)).toBe(false);
  });

  it("accepts the documented .dev.vars.example value under local", () => {
    expect(isUsableReplaySecret("local-dev-replay-secret-not-for-prod", "local")).toBe(true);
  });

  it("assertUsableReplaySecret returns the secret or throws a clear error", () => {
    expect(assertUsableReplaySecret(PROD_ENV)).toBe(SECRET);
    expect(() => assertUsableReplaySecret(envWith(PLACEHOLDER))).toThrow(/AGENT_REPLAY_SECRET/);
  });
});
