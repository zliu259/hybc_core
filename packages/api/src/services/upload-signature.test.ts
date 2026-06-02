import { describe, expect, it } from "vitest";

import {
  buildObjectUrl,
  buildSignedObjectUrl,
  isObjectAccessSignatureValid,
  signObjectAccess
} from "./upload-signature";

describe("upload signature", () => {
  it("builds verifiable object access URLs for file keys with folders", async () => {
    const key = "warehouse/evidence/photo 1.jpg";
    const expiresAt = 1_800_000_000_000;
    const signature = await signObjectAccess("secret", key, expiresAt);

    expect(buildSignedObjectUrl(key, expiresAt, signature)).toBe(
      `/api/v1/upload/object/${encodeURIComponent(key)}?expires=${expiresAt}&signature=${signature}`
    );
    await expect(
      isObjectAccessSignatureValid("secret", key, expiresAt, signature, expiresAt - 1)
    ).resolves.toBe(true);
  });

  it("builds absolute object URLs when an API base URL is provided", async () => {
    const key = "manager-log/144/photo.jpg";
    const expiresAt = 1_800_000_000_000;
    const signature = await signObjectAccess("secret", key, expiresAt);

    expect(buildObjectUrl(key, "https://api.hybcdg.com/")).toBe(
      `https://api.hybcdg.com/api/v1/upload/object/${encodeURIComponent(key)}`
    );
    expect(buildSignedObjectUrl(key, expiresAt, signature, "https://api.hybcdg.com/")).toBe(
      `https://api.hybcdg.com/api/v1/upload/object/${encodeURIComponent(
        key
      )}?expires=${expiresAt}&signature=${signature}`
    );
  });

  it("rejects expired or mismatched object access signatures", async () => {
    const key = "warehouse/evidence/photo.jpg";
    const expiresAt = 1_800_000_000_000;
    const signature = await signObjectAccess("secret", key, expiresAt);

    await expect(
      isObjectAccessSignatureValid("secret", key, expiresAt, signature, expiresAt + 1)
    ).resolves.toBe(false);
    await expect(
      isObjectAccessSignatureValid("secret", `${key}.changed`, expiresAt, signature, expiresAt - 1)
    ).resolves.toBe(false);
  });
});
