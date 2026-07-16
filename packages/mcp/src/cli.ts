#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { HybcApiClient } from "./api-client.js";
import { resolveBaseUrl } from "./config.js";
import {
  clearCredentials,
  readCredentials,
  saveCredentials,
  type StoredCredentials
} from "./credentials.js";
import { runLogin, type LoginResult } from "./device-login.js";
import { buildServer } from "./server.js";

export interface CliDeps {
  readCredentials: () => Promise<StoredCredentials | null>;
  saveCredentials: (creds: StoredCredentials) => Promise<void>;
  clearCredentials: () => Promise<void>;
  runLogin: (baseUrl: string) => Promise<LoginResult>;
  serve: (baseUrl: string, token: string) => Promise<void>;
  now: () => string;
  log: (message: string) => void;
}

export const runCli = async (argv: string[], deps: CliDeps): Promise<number> => {
  const cmd = argv[0] ?? "serve";

  if (cmd === "login") {
    const baseUrl = resolveBaseUrl((await deps.readCredentials())?.baseUrl);
    const result = await deps.runLogin(baseUrl);
    await deps.saveCredentials({
      baseUrl,
      token: result.token,
      wecomUserid: result.wecomUserid,
      role: result.role,
      savedAt: deps.now()
    });
    deps.log(`已登录：${result.wecomUserid}（${result.role}）。凭证已保存。`);
    return 0;
  }

  if (cmd === "logout") {
    await deps.clearCredentials();
    deps.log("已登出，凭证已清除。");
    return 0;
  }

  if (cmd === "whoami") {
    const creds = await deps.readCredentials();
    if (!creds) {
      deps.log("未登录。运行 `hybc-mcp login` 进行授权。");
      return 1;
    }
    deps.log(`${creds.wecomUserid}（${creds.role}）@ ${creds.baseUrl}`);
    return 0;
  }

  // serve (default)
  const creds = await deps.readCredentials();
  if (!creds) {
    deps.log("未登录，无法启动 MCP。请先运行 `hybc-mcp login`。");
    return 1;
  }
  await deps.serve(resolveBaseUrl(creds.baseUrl), creds.token);
  return 0;
};

const openBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // best effort; the URL is already printed to stderr
  }
};

const realServe = async (baseUrl: string, token: string): Promise<void> => {
  const client = new HybcApiClient(baseUrl, token);
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const realDeps: CliDeps = {
  readCredentials: () => readCredentials(),
  saveCredentials: (c) => saveCredentials(c),
  clearCredentials: () => clearCredentials(),
  runLogin: (baseUrl) =>
    runLogin({
      baseUrl,
      deviceName: `${process.env.USER ?? "user"}@${process.platform}`,
      agentType: process.env.HYBC_AGENT_TYPE ?? "unknown",
      openBrowser
    }),
  serve: realServe,
  now: () => new Date().toISOString(),
  log: (m) => process.stderr.write(`${m}\n`)
};

const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  runCli(process.argv.slice(2), realDeps)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
