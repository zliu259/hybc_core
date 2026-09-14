import { describe, expect, it, vi } from "vitest";

import type { Env } from "../types/env";

const apiMock = vi.hoisted(() => ({
  fetchWeComAccessToken: vi.fn(async () => "token-1"),
  fetchWeComJson: vi.fn(async (_env: unknown, url: string) => {
    if (url.includes("/tag/list")) {
      return {
        errcode: 0,
        taglist: [
          { tagid: 11, tagname: "HY_ROLE_SUPER_ADMIN" },
          { tagid: 12, tagname: "HY_ROLE_MANAGER" }
        ]
      };
    }
    if (url.includes("tagid=11")) return { errcode: 0, userlist: [{ userid: "Boss" }] };
    if (url.includes("tagid=12")) return { errcode: 0, userlist: [{ userid: "Mgr" }] };
    return { errcode: 0, userlist: [] };
  })
}));

vi.mock("./wecom-api", () => ({
  fetchWeComAccessToken: apiMock.fetchWeComAccessToken,
  fetchWeComJson: apiMock.fetchWeComJson,
  weComErrorMessage: (errmsg: string | undefined, fallback: string) =>
    !errmsg || errmsg === "ok" ? fallback : errmsg
}));

import { parseRoleTagMapping, resolveSystemRoleForUser } from "./wecom-role";

const env = { WECHAT_ROLE_TAG_MAPPING: undefined } as unknown as Env;

describe("parseRoleTagMapping", () => {
  it("空配置回落默认标签名", () => {
    expect(parseRoleTagMapping(undefined).super_admin).toEqual(["HY_ROLE_SUPER_ADMIN"]);
  });

  it("按 role:tag|tag;role:tag 解析并忽略未知角色", () => {
    const mapping = parseRoleTagMapping("super_admin:BOSS|OWNER;unknown:X;manager:M1");
    expect(mapping.super_admin).toEqual(["BOSS", "OWNER"]);
    expect(mapping.manager).toEqual(["M1"]);
    expect(mapping.finance).toEqual(["HY_ROLE_FINANCE"]);
  });
});

describe("resolveSystemRoleForUser", () => {
  it("命中超管标签返回 super_admin", async () => {
    expect(await resolveSystemRoleForUser(env, "Boss")).toBe("super_admin");
  });

  it("按优先级返回首个命中的角色", async () => {
    expect(await resolveSystemRoleForUser(env, "Mgr")).toBe("manager");
  });

  it("任何标签都不命中返回 null", async () => {
    expect(await resolveSystemRoleForUser(env, "Nobody")).toBeNull();
  });
});
