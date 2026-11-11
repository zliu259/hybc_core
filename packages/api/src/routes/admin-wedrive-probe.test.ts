import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

const authState = vi.hoisted(() => ({
  roles: ["super_admin"] as UserRole[],
  authMethod: "wecom_oauth" as "wecom_oauth" | "passkey" | "mcp_agent"
}));

const probeState = vi.hoisted(() => ({ calls: [] as Array<{ foreign_spaceid?: string }> }));

vi.mock("../services/auth", () => ({
  verifyToken: async () => ({
    sub: "admin-a",
    username: "admin-a",
    nickname: "Admin",
    avatar: "",
    roles: authState.roles,
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: authState.authMethod,
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

vi.mock("../services/wedrive-probe", () => ({
  runWedriveProbe: async (_env: Env, options: { foreign_spaceid?: string }) => {
    probeState.calls.push(options);
    return {
      started_at: "2026-11-11T00:00:00.000Z",
      finished_at: "2026-11-11T00:00:01.000Z",
      steps: [],
      cleaned_up: true,
      api_calls: 0
    };
  }
}));

const { adminWedriveProbeRoutes } = await import("./admin-wedrive-probe");

const env = { KV: { get: async () => "session" } } as unknown as Env;

const post = async (body: unknown) => {
  const app = new Hono();
  app.route("/admin/wedrive", adminWedriveProbeRoutes);
  const response = await app.request(
    "/admin/wedrive/probe",
    {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body)
    },
    env
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("POST /admin/wedrive/probe", () => {
  beforeEach(() => {
    authState.roles = ["super_admin"];
    authState.authMethod = "wecom_oauth";
    probeState.calls = [];
  });

  it("超管可以执行，外部空间参数原样传下去", async () => {
    const result = await post({ foreign_spaceid: " s.company " });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { cleaned_up: true } });
    expect(probeState.calls).toEqual([{ foreign_spaceid: "s.company" }]);
  });

  it("不传外部空间时不带这个参数", async () => {
    await post({});
    expect(probeState.calls).toEqual([{}]);
  });

  it("经理不能执行", async () => {
    authState.roles = ["manager"];
    const result = await post({});
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { message: "只有超级管理员可以执行" } });
    expect(probeState.calls).toEqual([]);
  });

  it("智能体令牌即使带超管角色也不能执行", async () => {
    authState.authMethod = "mcp_agent";
    const result = await post({});
    expect(result.status).toBe(403);
    expect(probeState.calls).toEqual([]);
  });
});
