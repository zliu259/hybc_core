import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import {
  getConfiguredWeComToolToken,
  saveWeComGroupWebhook,
  saveWeComToolToken
} from "./wecom-config";

class ConfigKv {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const createEnv = (vars: Partial<Env> = {}) =>
  ({
    KV: new ConfigKv(),
    ...vars
  }) as unknown as Env & { KV: ConfigKv };

describe("wecom config service", () => {
  it("saves and resolves a front-end configured tool token from KV first", async () => {
    const env = createEnv({ WECOM_BOT_TOOL_TOKEN: "env-token" });

    await saveWeComToolToken(env, "front-end-token-123456");
    const configured = await getConfiguredWeComToolToken(env);

    expect(configured).toEqual({
      token: "front-end-token-123456",
      source: "kv"
    });
  });

  it("stores group webhook URLs under secret refs without returning the URL", async () => {
    const env = createEnv();

    const result = await saveWeComGroupWebhook(env, {
      secret_ref: "prod-east",
      webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"
    });

    expect(result).toEqual({
      secret_ref: "prod-east",
      configured: true
    });
    expect(env.KV.values.get("wecom:group-webhook:prod-east")).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"
    );
  });

  it("rejects unsafe webhook refs and non-WeCom webhook URLs", async () => {
    const env = createEnv();

    await expect(
      saveWeComGroupWebhook(env, {
        secret_ref: "../prod",
        webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc"
      })
    ).rejects.toThrow("Invalid webhook secret ref");

    await expect(
      saveWeComGroupWebhook(env, {
        secret_ref: "prod-east",
        webhook_url: "https://example.com/webhook"
      })
    ).rejects.toThrow("Invalid WeCom webhook URL");
  });
});
