import { describe, expect, it } from "vitest";
import { shouldFallbackToRelay } from "./fallback-policy";

describe("shouldFallbackToRelay", () => {
  it("网络类错误触发", () => {
    for (const code of [
      "ECONNABORTED",
      "ERR_NETWORK",
      "ETIMEDOUT",
      "ERR_CONNECTION_ABORTED"
    ]) {
      expect(shouldFallbackToRelay({ code })).toBe(true);
    }
  });

  it("主入口 502/503/504 触发（Caddy 转发失败的信号）", () => {
    for (const status of [502, 503, 504]) {
      expect(shouldFallbackToRelay({ response: { status } })).toBe(true);
    }
  });

  it("其他响应不触发", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500]) {
      expect(shouldFallbackToRelay({ response: { status } })).toBe(false);
    }
  });

  it("无 code 无 response 不触发", () => {
    expect(shouldFallbackToRelay({})).toBe(false);
  });

  it("有 response 时不看 code（业务 4xx 带网络错误码也不回退）", () => {
    expect(
      shouldFallbackToRelay({
        code: "ERR_BAD_REQUEST",
        response: { status: 400 }
      })
    ).toBe(false);
  });
});
