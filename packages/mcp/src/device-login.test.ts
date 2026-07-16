import { afterEach, describe, expect, it, vi } from "vitest";

import { runLogin } from "./device-login";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

describe("runLogin", () => {
  it("starts device code, polls until granted, returns token", async () => {
    const responses = [
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "https://web.hybcdg.com/agent/authorize",
          verification_uri_complete:
            "https://web.hybcdg.com/agent/authorize?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      }),
      jsonResponse({ success: true, data: { status: "authorization_pending" } }),
      jsonResponse({
        success: true,
        data: {
          status: "granted",
          agent_token: "hybc_agent_new",
          wecom_userid: "MaxLiu",
          role: "manager"
        }
      })
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);

    const logs: string[] = [];
    const result = await runLogin({
      baseUrl: "https://api.hybcdg.com",
      deviceName: "Max MacBook",
      agentType: "claude_code",
      sleep: async () => undefined,
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
      openBrowser: () => undefined,
      log: (m) => logs.push(m)
    });

    expect(result).toEqual({
      token: "hybc_agent_new",
      wecomUserid: "MaxLiu",
      role: "manager"
    });
    expect(logs.join("\n")).toContain("ABCD-2345");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws on denied", async () => {
    const responses = [
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "x",
          verification_uri_complete: "x?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      }),
      jsonResponse({ success: true, data: { status: "denied" } })
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    await expect(
      runLogin({
        baseUrl: "https://api.hybcdg.com",
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => (t += 1000);
        })(),
        openBrowser: () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/拒绝|denied/i);
  });

  it("throws on expired poll status", async () => {
    const responses = [
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "x",
          verification_uri_complete: "x?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      }),
      jsonResponse({ success: true, data: { status: "expired" } })
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    await expect(
      runLogin({
        baseUrl: "https://api.hybcdg.com",
        sleep: async () => undefined,
        now: (() => {
          let t = 0;
          return () => (t += 1000);
        })(),
        openBrowser: () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/过期|expired/i);
  });

  it("throws timeout when the deadline passes before granting", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          device_code: "dev-1",
          user_code: "ABCD-2345",
          verification_uri: "x",
          verification_uri_complete: "x?user_code=ABCD-2345",
          expires_in: 600,
          interval: 5
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const nowSeq = [0, 700000]; // deadline calc, then loop check already past deadline
    await expect(
      runLogin({
        baseUrl: "https://api.hybcdg.com",
        sleep: async () => undefined,
        now: () => nowSeq.shift() ?? 700000,
        openBrowser: () => undefined,
        log: () => undefined
      })
    ).rejects.toThrow(/超时|timeout/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only /device/code, never polled
  });
});
