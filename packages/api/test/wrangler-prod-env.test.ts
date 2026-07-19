import { readdirSync, readFileSync } from "node:fs";
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

/**
 * AGENT_REPLAY_SECRET 是高危写重放标记的 HMAC 密钥,【只能】走 secret store。
 *
 * Workers 里同名的明文 var 与 secret 会相撞,且部署时的 var 获胜。由于 push 到 main 即自动
 * 部署,wrangler.toml 里只要留着这一行(哪怕是占位值),每次发布都会把已用
 * `wrangler secret put` 正确配置的密钥覆盖回占位串——assertUsableReplaySecret 随即 fail-closed,
 * 整条「企业微信确认后重放」链路静默失效。它同时制造了把真实密钥粘进受版本控制文件的压力。
 *
 * 与上面 APP_ENV 的教训是同一个:顶层 [vars] 与 [env.prod.vars] 两处都必须干净。
 */
/**
 * 上面两组只盯 wrangler.toml。但 APP_ENV 的教训与**文件名无关**:任何绑生产资源的
 * 配置,只要 APP_ENV="local",就等于给生产开一扇免认证的门
 * (routes/auth.ts 的 /login/web 在 APP_ENV==="local" 时接受裸 {"username"} 直接签发会话)。
 *
 * wrangler.deploy.toml 就是这么埋进来的:绑 hybcdg-prod-* 全套,却写着 APP_ENV="local"。
 * 它当时不在默认部署路径上(package.json 的 deploy 是裸 `wrangler deploy`,走 wrangler.toml),
 * 所以只是颗地雷 —— 但 `wrangler deploy -c wrangler.deploy.toml` 一跑就是生产事故,
 * 且这已经是同一个失效模式的**第二次**出现。
 *
 * 因此这里 glob 整个 packages/api 目录,而不是硬编码文件名:目的正是守住**还不存在的**
 * 配置文件 —— 下次谁新增一个 wrangler.xxx.toml,自动纳入。
 * 不变式:文件引用了任何 hybcdg-prod-* 资源 ⇒ 该文件任何 vars 段落都不得 APP_ENV="local"。
 */
const wranglerConfigs = readdirSync(apiRoot)
  .filter((name) => /^wrangler.*\.toml$/.test(name))
  .sort();

/** 枚举文件中所有 vars 段落(顶层 [vars] 与 [env.*.vars])的 header 与正文。 */
const varsSections = (
  content: string
): Array<{ header: string; body: string }> => {
  const lines = content.split("\n");
  const found: Array<{ header: string; body: string }> = [];

  lines.forEach((line, index) => {
    const header = line.trim();
    // 只认 vars 段落头,例如 [vars] / [env.prod.vars] —— 不含 [[...]] 数组表。
    if (!/^\[[^[\]]*vars\]$/.test(header)) {
      return;
    }
    const rest = lines.slice(index + 1);
    const end = rest.findIndex((next) => next.trim().startsWith("["));
    found.push({
      header,
      body: (end === -1 ? rest : rest.slice(0, end)).join("\n")
    });
  });

  return found;
};

/** 取出文件中所有 vars 段落的 APP_ENV 值。 */
const appEnvsInVarsSections = (
  content: string
): Array<{ header: string; value: string }> =>
  varsSections(content).flatMap(({ header, body }) => {
    const match = body.match(/^\s*APP_ENV\s*=\s*"([^"]*)"/m);
    return match ? [{ header, value: match[1] }] : [];
  });

describe("任意 wrangler*.toml:绑生产资源就不得 APP_ENV=local", () => {
  it("至少扫到 wrangler.toml 与 wrangler.deploy.toml(否则说明 glob 失效了)", () => {
    expect(wranglerConfigs).toEqual(
      expect.arrayContaining(["wrangler.toml", "wrangler.deploy.toml"])
    );
  });

  it.each(wranglerConfigs)(
    "%s 引用 hybcdg-prod-* 时,任何 vars 段落都不得 APP_ENV=\"local\"",
    (fileName) => {
      const content = readFileSync(resolve(apiRoot, fileName), "utf8");
      if (!content.includes("hybcdg-prod-")) {
        return; // 未绑生产资源,不受此不变式约束。
      }

      const offenders = appEnvsInVarsSections(content)
        .filter((entry) => entry.value === "local")
        .map((entry) => `${entry.header} APP_ENV="local"`);

      expect(offenders).toEqual([]);
    }
  );
});

describe("wrangler.toml AGENT_REPLAY_SECRET", () => {
  it.each(["[vars]", "[env.prod.vars]"])(
    "%s 不得声明 AGENT_REPLAY_SECRET(明文 var 会在部署时压过 secret)",
    (header) => {
      expect(sectionOf(header)).not.toMatch(/^\s*AGENT_REPLAY_SECRET\s*=/m);
    }
  );

  it("整个 wrangler.toml 都不出现该键(任何 env 段落粘回来都算回归)", () => {
    expect(wranglerToml).not.toMatch(/^\s*AGENT_REPLAY_SECRET\s*=/m);
  });

  it(".dev.vars.example 必须写明生产只走 `wrangler secret put`", () => {
    const example = readFileSync(resolve(apiRoot, ".dev.vars.example"), "utf8");
    expect(example).toMatch(/wrangler secret put AGENT_REPLAY_SECRET/);
  });
});

/**
 * 上面那组只盯 wrangler.toml 里的 AGENT_REPLAY_SECRET 一个键。但这类失效模式与
 * **键名和文件名都无关**:凡是密钥,写成明文 var 就有两个后果 ——
 *  1) Workers 里同名的明文 var 与 secret 不能共存(API 10053):部署要么直接失败,
 *     要么把已用 `wrangler secret put` 配好的值覆盖回明文;
 *  2) 配置文件受版本控制,值一旦提交就在 git 历史里**永久**暴露,后续删除也追不回,
 *     只能轮换密钥。
 *
 * 这不是假想:JWT_SECRET / UPLOAD_SIGNING_SECRET / TASK_API_KEY / WECHAT_SECRET /
 * WECHAT_BRIDGE_TOKEN 的真实生产值从仓库首个提交起就明文躺在 wrangler.toml 与
 * wrangler.deploy.toml 里,直到 2026-07-19 才迁到 Worker Secrets。
 *
 * 与 APP_ENV 同款做法:glob 整个 packages/api 目录 + 扫**所有** vars 段落,
 * 目的是守住**还不存在的**配置文件和**还没加的** env 段落。
 */
const SECRET_ONLY_KEYS = [
  "JWT_SECRET",
  "UPLOAD_SIGNING_SECRET",
  "TASK_API_KEY",
  "WECHAT_SECRET",
  "WECHAT_BRIDGE_TOKEN",
  "AGENT_REPLAY_SECRET"
] as const;

/** 在任意 vars 段落里以 `KEY = ...` 形式赋值的密钥键(注释行不算)。 */
const secretVarAssignments = (
  content: string
): Array<{ header: string; key: string }> =>
  varsSections(content).flatMap(({ header, body }) =>
    SECRET_ONLY_KEYS.filter((key) =>
      new RegExp(`^\\s*${key}\\s*=`, "m").test(body)
    ).map((key) => ({ header, key }))
  );

describe("任意 wrangler*.toml:密钥不得写成明文 var", () => {
  it.each(wranglerConfigs)(
    "%s 的任何 vars 段落都不得声明密钥键",
    (fileName) => {
      const content = readFileSync(resolve(apiRoot, fileName), "utf8");
      const offenders = secretVarAssignments(content).map(
        ({ header, key }) =>
          `${fileName} ${header} 里声明了 ${key}:请删除该行,改用 ` +
          `\`wrangler secret put ${key} --env prod\` 下发(本地开发放进 .dev.vars)。` +
          `明文 var 会与同名 secret 相撞(10053),且提交过的值在 git 历史里永久暴露。`
      );

      expect(offenders).toEqual([]);
    }
  );

  it(".dev.vars.example 必须覆盖全部密钥键(本地唯一来源,值须为假占位)", () => {
    const example = readFileSync(resolve(apiRoot, ".dev.vars.example"), "utf8");
    const missing = SECRET_ONLY_KEYS.filter(
      (key) => !new RegExp(`^${key}=`, "m").test(example)
    );

    expect(missing).toEqual([]);
  });
});
