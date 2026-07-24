import { describe, expect, it } from "vitest";

import adminRoutes from "./admin";
import agentRoutes from "./agent";

type RouteMeta = {
  showLink?: boolean;
  roles?: string[];
  title?: string;
};

type RouteNode = {
  path: string;
  name?: string;
  component?: unknown;
  meta?: RouteMeta;
  children?: RouteNode[];
};

const ALL_ROLES = [
  "super_admin",
  "manager",
  "site_manager",
  "finance",
  "operator"
];

const asRoute = (route: unknown): RouteNode => route as RouteNode;

const requireChild = (parent: RouteNode, path: string): RouteNode => {
  const child = parent.children?.find(route => route.path === path);
  expect(child, `missing route ${path}`).toBeDefined();
  if (!child) throw new Error(`missing route ${path}`);
  return child;
};

describe("智能体接入菜单路由", () => {
  it("在 AI 与计算节点下向全部角色开放接入配置和设备授权", () => {
    const aiGroup = requireChild(asRoute(adminRoutes), "/admin/g-ai");
    expect(aiGroup.meta?.roles).toEqual(ALL_ROLES);

    const setup = requireChild(aiGroup, "/agent/setup");
    expect(setup.name).toBe("AgentSetup");
    expect(setup.meta).toEqual({
      title: "智能体接入配置",
      roles: ALL_ROLES
    });
    expect(typeof setup.component).toBe("function");

    const grants = requireChild(aiGroup, "/agent/grants");
    expect(grants.name).toBe("AgentGrants");
    expect(grants.meta).toEqual({
      title: "设备授权",
      roles: ALL_ROLES
    });
    expect(typeof grants.component).toBe("function");
  });

  it("保留设备授权确认和高危操作确认两个隐藏入口", () => {
    const hiddenAgentGroup = asRoute(agentRoutes);
    expect(hiddenAgentGroup.meta?.showLink).toBe(false);
    expect(hiddenAgentGroup.children?.map(route => route.path)).toEqual([
      "/agent/authorize",
      "/agent/confirm"
    ]);

    for (const route of hiddenAgentGroup.children ?? []) {
      expect(route.meta?.showLink).toBe(false);
      expect(route.meta?.roles).toEqual(ALL_ROLES);
    }
  });

  it("不放宽既有 AI 管理页面权限", () => {
    const aiGroup = requireChild(asRoute(adminRoutes), "/admin/g-ai");
    expect(requireChild(aiGroup, "/admin/ai-center").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/ai-gate-tasks").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/runner-center").meta?.roles).toEqual([
      "super_admin"
    ]);
    expect(requireChild(aiGroup, "/admin/vertex-bridge").meta?.roles).toEqual([
      "super_admin",
      "manager",
      "site_manager"
    ]);
  });
});
