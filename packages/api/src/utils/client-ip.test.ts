import { describe, expect, it } from "vitest";

import { isTrustedRelay, resolveClientIp } from "./client-ip";

const env = { RELAY_TRUST_TOKEN: "0123456789abcdef0123456789abcdef" };
const h = (init: Record<string, string>) => new Headers(init);

describe("resolveClientIp", () => {
  it("直连 Cloudflare：取 cf-connecting-ip，忽略客户端自带的 XFF 与伪造令牌", () => {
    const headers = h({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "10.0.0.1",
      "x-relay-auth": "wrong"
    });
    expect(resolveClientIp(headers, env)).toBe("203.0.113.9");
  });

  it("可信中转：取 XFF 首跳（Cloudflare 会把 VM IP 追加在后）", () => {
    const headers = h({
      "cf-connecting-ip": "13.114.172.128",
      "x-forwarded-for": "203.0.113.9, 13.114.172.128",
      "x-relay-auth": env.RELAY_TRUST_TOKEN
    });
    expect(resolveClientIp(headers, env)).toBe("203.0.113.9");
  });

  it("可信中转但 XFF 缺失或为空：退回 cf-connecting-ip", () => {
    expect(
      resolveClientIp(
        h({ "cf-connecting-ip": "13.114.172.128", "x-relay-auth": env.RELAY_TRUST_TOKEN }),
        env
      )
    ).toBe("13.114.172.128");
    expect(
      resolveClientIp(
        h({
          "cf-connecting-ip": "13.114.172.128",
          "x-forwarded-for": "  ",
          "x-relay-auth": env.RELAY_TRUST_TOKEN
        }),
        env
      )
    ).toBe("13.114.172.128");
  });

  it("未配置令牌时任何 X-Relay-Auth 都不可信", () => {
    const headers = h({
      "cf-connecting-ip": "13.114.172.128",
      "x-forwarded-for": "203.0.113.9",
      "x-relay-auth": ""
    });
    expect(resolveClientIp(headers, {})).toBe("13.114.172.128");
    expect(isTrustedRelay(headers, { RELAY_TRUST_TOKEN: "" })).toBe(false);
  });

  it("无 cf-connecting-ip 时按 x-forwarded-for 首跳、x-real-ip 顺序兜底，全无则 undefined", () => {
    expect(resolveClientIp(h({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }), {})).toBe(
      "198.51.100.7"
    );
    expect(resolveClientIp(h({ "x-real-ip": "198.51.100.8" }), {})).toBe("198.51.100.8");
    expect(resolveClientIp(h({}), {})).toBeUndefined();
  });

  it("令牌短于 16 字符视为未配置（防占位值生效）", () => {
    expect(isTrustedRelay(h({ "x-relay-auth": "short" }), { RELAY_TRUST_TOKEN: "short" })).toBe(
      false
    );
  });

  it("令牌匹配但请求头大小写不同仍可信（Headers 不区分大小写）", () => {
    const headers = new Headers();
    headers.set("X-Relay-Auth", env.RELAY_TRUST_TOKEN);
    headers.set("X-Forwarded-For", "203.0.113.9");
    expect(isTrustedRelay(headers, env)).toBe(true);
    expect(resolveClientIp(headers, env)).toBe("203.0.113.9");
  });
});
