import { describe, expect, it } from "vitest";

import { getSystemConfig, getSystemConfigEntry, setSystemConfig } from "./system-config";
import type { Env } from "../types/env";

type Row = { config_value: string; updated_by: string | null; updated_at: string };

const createFakeEnv = (rows: Map<string, Row>) => {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (/FROM\s+system_config/i.test(sql)) {
                const row = rows.get(String(args[0]));
                return (row ? { ...row } : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async run() {
              runs.push({ sql, args });
              if (/INSERT\s+INTO\s+system_config/i.test(sql)) {
                rows.set(String(args[0]), {
                  config_value: String(args[1]),
                  updated_by: (args[2] as string | null) ?? null,
                  updated_at: String(args[4])
                });
              }
              return { success: true, meta: {} };
            },
            async all<T>() {
              return { results: [] as T[] };
            }
          };
        }
      };
    }
  };
  return { env: { DB: db } as unknown as Env, runs, rows };
};

describe("system-config", () => {
  it("未配置返回 null", async () => {
    const { env } = createFakeEnv(new Map());
    expect(await getSystemConfig(env, "approval.ai_gate.fallback_reviewer_userid")).toBeNull();
    expect(await getSystemConfigEntry(env, "approval.ai_gate.fallback_reviewer_userid")).toBeNull();
  });

  it("空白值视为未配置", async () => {
    const rows = new Map<string, Row>([
      ["k", { config_value: "   ", updated_by: "boss", updated_at: "2026-09-14T00:00:00.000Z" }]
    ]);
    const { env } = createFakeEnv(rows);
    expect(await getSystemConfig(env, "k")).toBeNull();
  });

  it("setSystemConfig 走 upsert，回读得到 trim 后的值与更新人", async () => {
    const { env, runs, rows } = createFakeEnv(new Map());
    await setSystemConfig(env, "k", "  UserA ", "boss");
    expect(runs[0].sql).toMatch(/INSERT\s+INTO\s+system_config/i);
    expect(runs[0].sql).toMatch(/ON\s+CONFLICT\s*\(\s*config_key\s*\)\s+DO\s+UPDATE/i);
    expect(rows.get("k")?.config_value).toBe("UserA");
    expect(await getSystemConfig(env, "k")).toBe("UserA");
    const entry = await getSystemConfigEntry(env, "k");
    expect(entry?.updated_by).toBe("boss");
  });
});
