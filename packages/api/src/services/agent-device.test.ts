import { describe, expect, it } from "vitest";

import { createFakeD1, createFakeKV } from "../test-support/agent-fakes";
import {
  approveDeviceByUserCode,
  pollDeviceToken,
  provisionBootstrapGrant,
  redeemBootstrap,
  startDeviceAuthorization
} from "./agent-device";

describe("agent-device", () => {
  it("runs the device flow: start -> approve -> poll returns token once", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();

    const start = await startDeviceAuthorization(kv, {
      webBaseUrl: "https://web.hybcdg.com",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(start.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(start.verification_uri_complete).toContain(start.user_code);

    expect(await pollDeviceToken(kv, db, start.device_code)).toEqual({
      status: "authorization_pending"
    });

    await approveDeviceByUserCode(kv, db, start.user_code, {
      wecomUserid: "MaxLiu",
      role: "manager"
    });

    const granted = await pollDeviceToken(kv, db, start.device_code);
    expect(granted.status).toBe("granted");
    if (granted.status === "granted") {
      expect(granted.agent_token.startsWith("hybc_agent_")).toBe(true);
      expect(granted.wecom_userid).toBe("MaxLiu");
      expect(granted.role).toBe("manager");
    }

    // token issued only once
    expect(await pollDeviceToken(kv, db, start.device_code)).toEqual({
      status: "expired"
    });
  });

  it("rejects approving an unknown user_code", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    await expect(
      approveDeviceByUserCode(kv, db, "ZZZZ-ZZZZ", {
        wecomUserid: "MaxLiu",
        role: "operator"
      })
    ).rejects.toThrow(/user_code/i);
  });

  it("provisions via bootstrap and redeems once", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const prov = await provisionBootstrapGrant(kv, db, {
      wecomUserid: "MaxLiu",
      role: "finance",
      deviceName: "Max MacBook",
      agentType: "claude_code"
    });
    expect(prov.boot_code).toBeTruthy();

    const redeemed = await redeemBootstrap(kv, prov.boot_code);
    expect(redeemed?.agent_token.startsWith("hybc_agent_")).toBe(true);
    expect(await redeemBootstrap(kv, prov.boot_code)).toBeNull();
  });

  it("rejects approving an already-resolved user_code", async () => {
    const { db } = createFakeD1();
    const { kv } = createFakeKV();
    const start = await startDeviceAuthorization(kv, {
      webBaseUrl: "https://web.hybcdg.com"
    });
    await approveDeviceByUserCode(kv, db, start.user_code, {
      wecomUserid: "MaxLiu",
      role: "operator"
    });
    await expect(
      approveDeviceByUserCode(kv, db, start.user_code, {
        wecomUserid: "MaxLiu",
        role: "operator"
      })
    ).rejects.toThrow(/already resolved/i);
  });

  it("requires a non-empty webBaseUrl", async () => {
    const { kv } = createFakeKV();
    await expect(
      startDeviceAuthorization(kv, { webBaseUrl: "" })
    ).rejects.toThrow(/webBaseUrl/i);
  });
});
