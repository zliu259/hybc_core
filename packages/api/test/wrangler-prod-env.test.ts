import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 生产 health 曾返回 env:"local" —— 根因是 wrangler.toml 的 [env.prod.vars]
// 把 APP_ENV 硬编码成了 "local"。APP_ENV 不只是展示字段:
//  - routes/auth.ts 的 /login/web 免 WeCom-code 登录旁路以 APP_ENV === "local" 放行;
//  - services/passkey.ts 在 KV 无配置时以 APP_ENV === "local" 决定 passkey 默认开关。
// 生产误标 "local" 等于在生产开启免认证登录旁路。这个测试直接断言部署配置本身,
// 防止该值再次回归。(放在 test/ 而非 src/:tsconfig 的 types 只有 workers-types,
// src 内用 node:fs 会挂 typecheck;vitest 默认会收集本目录。)

const wranglerToml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../wrangler.toml"),
  "utf8"
);

const sectionOf = (header: string): string => {
  const lines = wranglerToml.split("\n");
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return "";
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim().startsWith("["));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

const appEnvIn = (section: string): string | null => {
  const match = section.match(/^\s*APP_ENV\s*=\s*"([^"]*)"/m);
  return match ? match[1] : null;
};

describe("wrangler.toml APP_ENV", () => {
  it('[env.prod.vars] APP_ENV 必须是 "production"(否则生产开启 local-only 登录旁路)', () => {
    expect(appEnvIn(sectionOf("[env.prod.vars]"))).toBe("production");
  });

  it('顶层 [vars] APP_ENV 保持 "local"(本地 wrangler dev 依赖它)', () => {
    expect(appEnvIn(sectionOf("[vars]"))).toBe("local");
  });
});
