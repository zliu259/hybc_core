import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 库房每个写接口的权限：标"否"的身份必须 403，标"是"的身份不能是 401 或 403。

const authState = vi.hoisted(() => ({ sub: "u", roles: ["operator"], authMethod: "wecom_oauth" }));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: authState.sub,
    username: authState.sub,
    nickname: authState.sub,
    avatar: "",
    roles: authState.roles,
    permissions: [],
    tokenId: `token-${authState.sub}`,
    type: "access",
    auth_method: authState.authMethod,
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

const IDENTITIES = {
  operator: { sub: "op", roles: ["operator"], authMethod: "wecom_oauth" },
  site_manager: { sub: "sm", roles: ["site_manager"], authMethod: "wecom_oauth" },
  manager: { sub: "mg", roles: ["manager"], authMethod: "wecom_oauth" },
  keeper: { sub: "kp", roles: ["operator"], authMethod: "wecom_oauth" },
  super_admin: { sub: "sa", roles: ["super_admin"], authMethod: "wecom_oauth" },
  agent: { sub: "sa", roles: ["super_admin"], authMethod: "mcp_agent" }
};

const SETTINGS = { manager: true, super_admin: true };
const KEEPER = { keeper: true, super_admin: true };
const SCRAP = { manager: true, super_admin: true };
const UNSCRAP = { super_admin: true };

const MATRIX = [
  ["PUT", "/warehouse/settings", SETTINGS],
  ["POST", "/warehouse/member", SETTINGS],
  ["DELETE", "/warehouse/member/u/keeper", SETTINGS],
  ["POST", "/warehouse/device-category", KEEPER],
  ["POST", "/warehouse/device", KEEPER],
  ["PUT", "/warehouse/device/1", KEEPER],
  ["POST", "/warehouse/device/1/note", KEEPER],
  ["POST", "/warehouse/device/import", KEEPER],
  ["POST", "/warehouse/material", KEEPER],
  ["PUT", "/warehouse/material/1", KEEPER],
  ["POST", "/warehouse/material/import", KEEPER],
  ["POST", "/warehouse/doc", KEEPER],
  ["POST", "/warehouse/doc/1/reverse", KEEPER],
  ["POST", "/warehouse/task", KEEPER],
  ["POST", "/warehouse/task/1/assign", KEEPER],
  ["POST", "/warehouse/task/1/confirm", KEEPER],
  ["POST", "/warehouse/task/1/send-back", KEEPER],
  ["POST", "/warehouse/task/1/cancel", KEEPER],
  ["POST", "/warehouse/device/1/scrap", SCRAP],
  ["POST", "/warehouse/device/1/unscrap", UNSCRAP]
];

const CASES = MATRIX.flatMap(([method, path, allowed]) =>
  Object.keys(IDENTITIES).map((who) => [method, path, who, Boolean(allowed[who])])
);

const READS = [
  "/warehouse/me",
  "/warehouse/settings",
  "/warehouse/member",
  "/warehouse/device-category",
  "/warehouse/device",
  "/warehouse/material",
  "/warehouse/inventory",
  "/warehouse/inventory/alert",
  "/warehouse/doc",
  "/warehouse/task",
  "/warehouse/overview",
  "/warehouse/project/1/holdings"
];

describe.skipIf(!hasSqlite)("库房权限矩阵", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
    h.seed.member("kp", "keeper");
  });

  it.each(CASES)("%s %s 身份 %s 允许=%s", async (method, path, who, allowed) => {
    Object.assign(authState, IDENTITIES[who]);
    const result = await callWh(h, mountWarehouseRoutes, method, path, {});
    if (allowed) {
      expect([401, 403]).not.toContain(result.status);
    } else {
      expect(result.status).toBe(403);
    }
  });

  it.each(READS)("GET %s 财务能看", async (path) => {
    Object.assign(authState, { sub: "fin", roles: ["finance"], authMethod: "wecom_oauth" });
    const result = await callWh(h, mountWarehouseRoutes, "GET", path);
    expect(result.status).toBe(200);
  });

  it.each(READS)("GET %s 不带令牌 401", async (path) => {
    const app = new Hono();
    mountWarehouseRoutes(app);
    const response = await app.request(`/api/v1${path}`, {}, h.env);
    expect(response.status).toBe(401);
  });
});
