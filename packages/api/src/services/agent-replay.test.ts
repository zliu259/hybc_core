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

/** 32+ 字符、字符种类充足的测试密钥（满足非 local 环境的强度要求）。 */
const SECRET = "test-replay-secret-long-enough-0123456789";
const PLACEHOLDER = "REPLACE_WITH_PROD_SECRET";

const envWith = (secret: string, appEnv = "production"): Env =>
  ({ AGENT_REPLAY_SECRET: secret, APP_ENV: appEnv }) as unknown as Env;

const PROD_ENV = envWith(SECRET);

/**
 * 攻击者视角：仓库里公开的占位密钥人人可读，攻击者可以自己算 HMAC。
 * 这里绕开本模块、直接用 Web Crypto 复刻签名，用来证明「占位密钥签出的标记必须不被接受」。
 */
const forgeMarkerOutOfBand = async (
  secret: string,
  pendingId: string,
  bodyHash: string
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
    new TextEncoder().encode(`${pendingId}:${bodyHash}`)
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
    const bodyHash = await sha256Hex('{"comment":"ok"}');
    const marker = await signReplayMarker(PROD_ENV, "pending-1", bodyHash);
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", bodyHash, marker)).toBe(true);
  });

  it("rejects a marker signed with a different secret", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker(
      envWith("other-secret-value-that-is-long-enough-0123"),
      "pending-1",
      bodyHash
    );
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker bound to a different pending id", async () => {
    const bodyHash = await sha256Hex("{}");
    const marker = await signReplayMarker(PROD_ENV, "pending-1", bodyHash);
    expect(await verifyReplayMarker(PROD_ENV, "pending-2", bodyHash, marker)).toBe(false);
  });

  it("rejects a marker when the body changed", async () => {
    const marker = await signReplayMarker(PROD_ENV, "pending-1", await sha256Hex("{}"));
    const tampered = await sha256Hex('{"comment":"evil"}');
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", tampered, marker)).toBe(false);
  });

  it("rejects garbage, empty and truncated markers without throwing", async () => {
    const bodyHash = await sha256Hex("{}");
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", bodyHash, "")).toBe(false);
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", bodyHash, "!!!not-base64!!!")).toBe(
      false
    );
    const marker = await signReplayMarker(PROD_ENV, "pending-1", bodyHash);
    expect(await verifyReplayMarker(PROD_ENV, "pending-1", bodyHash, marker.slice(0, 8))).toBe(
      false
    );
  });

  it("exposes the header name used to carry the marker", () => {
    expect(REPLAY_HEADER).toBe("x-hybc-agent-replay");
  });
});

describe("guard is mandatory, not advisory (regression: unusable secret must not sign or verify)", () => {
  it("refuses to sign with the placeholder secret", async () => {
    const bodyHash = await sha256Hex("{}");
    await expect(signReplayMarker(envWith(PLACEHOLDER), "pending-1", bodyHash)).rejects.toThrow(
      /AGENT_REPLAY_SECRET/
    );
  });

  it("rejects a marker forged with the publicly-committed placeholder", async () => {
    const bodyHash = await sha256Hex("{}");
    const forged = await forgeMarkerOutOfBand(PLACEHOLDER, "pending-1", bodyHash);
    // 攻击者用占位密钥算出的标记，服务端即使配的就是占位密钥也必须拒绝（fail closed）。
    expect(await verifyReplayMarker(envWith(PLACEHOLDER), "pending-1", bodyHash, forged)).toBe(
      false
    );
  });

  it("returns false (never throws) when the configured secret is weak or missing", async () => {
    const bodyHash = await sha256Hex("{}");
    const forged = await forgeMarkerOutOfBand("short", "pending-1", bodyHash);
    expect(await verifyReplayMarker(envWith("short"), "pending-1", bodyHash, forged)).toBe(false);
    expect(await verifyReplayMarker(envWith(""), "pending-1", bodyHash, forged)).toBe(false);
  });
});

describe("payload invariants (delimiter must stay unambiguous)", () => {
  it("rejects a bodyHash that is not 64 lowercase hex chars", async () => {
    await expect(signReplayMarker(PROD_ENV, "pending-1", "y:z")).rejects.toThrow(/bodyHash/);
    await expect(signReplayMarker(PROD_ENV, "pending-1", "")).rejects.toThrow(/bodyHash/);
    await expect(signReplayMarker(PROD_ENV, "pending-1", "A".repeat(64))).rejects.toThrow(
      /bodyHash/
    );
    await expect(
      signReplayMarker(PROD_ENV, "pending-1", undefined as unknown as string)
    ).rejects.toThrow(/bodyHash/);
  });

  it("rejects a pendingId that is empty or contains the delimiter", async () => {
    const bodyHash = await sha256Hex("{}");
    await expect(signReplayMarker(PROD_ENV, "", bodyHash)).rejects.toThrow(/pendingId/);
    await expect(signReplayMarker(PROD_ENV, "pending:1", bodyHash)).rejects.toThrow(/pendingId/);
    await expect(
      signReplayMarker(PROD_ENV, undefined as unknown as string, bodyHash)
    ).rejects.toThrow(/pendingId/);
  });

  it("closes the (pendingId, bodyHash) split ambiguity", async () => {
    // 历史隐患：sign(S,"x","y:z") === sign(S,"x:y","z")。两侧现在都必须直接抛错。
    await expect(signReplayMarker(PROD_ENV, "x", "y:z")).rejects.toThrow();
    await expect(signReplayMarker(PROD_ENV, "x:y", "z")).rejects.toThrow();
  });

  it("verifyReplayMarker returns false rather than throwing on invalid payload parts", async () => {
    expect(await verifyReplayMarker(PROD_ENV, "x", "y:z", "whatever")).toBe(false);
    expect(await verifyReplayMarker(PROD_ENV, "", "z", "whatever")).toBe(false);
    expect(
      await verifyReplayMarker(
        PROD_ENV,
        undefined as unknown as string,
        undefined as unknown as string,
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
