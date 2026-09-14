import { describe, expect, it } from "vitest";

import {
  AI_GATE_FALLBACK_REVIEWER_KEY,
  hasPendingHumanTaskOnNode,
  resolveAiGateFallbackReviewer
} from "./ai-gate-fallback";
import type { Env } from "../../types/env";

const createFakeEnv = (options: {
  configValue?: string | null;
  pendingHumanTaskId?: number | null;
}) => {
  const captured: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          captured.push({ sql, args });
          return {
            async first<T>() {
              if (/FROM\s+system_config/i.test(sql)) {
                return (options.configValue == null
                  ? null
                  : {
                      config_value: options.configValue,
                      updated_by: null,
                      updated_at: ""
                    }) as unknown as T;
              }
              if (/FROM\s+approval_task/i.test(sql)) {
                return (options.pendingHumanTaskId
                  ? { id: options.pendingHumanTaskId }
                  : null) as unknown as T;
              }
              return null as unknown as T;
            },
            async run() {
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
  return { env: { DB: db } as unknown as Env, captured };
};

describe("resolveAiGateFallbackReviewer", () => {
  it("键名固定", () => {
    expect(AI_GATE_FALLBACK_REVIEWER_KEY).toBe("approval.ai_gate.fallback_reviewer_userid");
  });

  it("未配置返回 null", async () => {
    const { env } = createFakeEnv({ configValue: null });
    expect(await resolveAiGateFallbackReviewer(env)).toBeNull();
  });

  it("返回 trim 后的 userid", async () => {
    const { env } = createFakeEnv({ configValue: " Boss " });
    expect(await resolveAiGateFallbackReviewer(env)).toBe("Boss");
  });
});

describe("hasPendingHumanTaskOnNode", () => {
  it("查询排除 AI_GATE 且只看 pending，命中返回 true", async () => {
    const { env, captured } = createFakeEnv({ pendingHumanTaskId: 9 });
    expect(await hasPendingHumanTaskOnNode(env, 1931)).toBe(true);
    const query = captured.find((c) => /FROM\s+approval_task/i.test(c.sql));
    expect(query?.sql).toMatch(/assignee_userid\s*<>\s*'AI_GATE'/);
    expect(query?.sql).toMatch(/status\s*=\s*'pending'/);
    expect(query?.args[0]).toBe(1931);
  });

  it("无命中返回 false", async () => {
    const { env } = createFakeEnv({ pendingHumanTaskId: null });
    expect(await hasPendingHumanTaskOnNode(env, 1931)).toBe(false);
  });
});
