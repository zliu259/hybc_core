import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 生产 health 曾返回 env:"local" —— 根因是 wrangler.toml 把 APP_ENV 硬编码成了
// "local"。APP_ENV 不只是展示字段:
//  - routes/auth.ts 的 /login/web 免 WeCom-code 登录旁路以 APP_ENV === "local" 放行;
//  - services/passkey.ts 在 KV 无配置时以 APP_ENV === "local" 决定 passkey 默认开关。
// 生产误标 "local" 等于在生产开启免认证登录旁路。
//
// 2026-07-16 实测:CF Workers Builds 自动部署实际采用**顶层 [vars]**(而非
// [env.prod.vars])构建 hybc-api-prod,曾把手动修复覆盖回 local。因此两个 section
// 都必须是 "production";本地 dev 的 "local" 由 .dev.vars(gitignore)提供,
// .dev.vars.example 必须保留 APP_ENV=local 供开发机复制。
// (放在 test/ 而非 src/:tsconfig 的 types 只有 workers-types,src 内用
// node:fs 会挂 typecheck;vitest 默认会收集本目录。)

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerToml = readFileSync(resolve(apiRoot, "wrangler.toml"), "utf8");

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

  it('顶层 [vars] APP_ENV 也必须是 "production"(Workers Builds 自动部署实际用顶层 vars)', () => {
    expect(appEnvIn(sectionOf("[vars]"))).toBe("production");
  });

  it('.dev.vars.example 必须保留 APP_ENV=local(本地 dev 靠 .dev.vars 覆盖)', () => {
    const example = readFileSync(resolve(apiRoot, ".dev.vars.example"), "utf8");
    expect(example).toMatch(/^APP_ENV=local$/m);
  });
});
