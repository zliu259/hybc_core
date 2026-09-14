/**
 * 企微标签 → 系统角色解析。从 routes/auth.ts 抽出，登录、通讯录权限标注、
 * AI 关卡兜底审核人校验（routes/admin.ts）共用。
 */
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

import { fetchWeComAccessToken, fetchWeComJson, weComErrorMessage } from "./wecom-api";

type WeComTagListResponse = {
  errcode?: number;
  errmsg?: string;
  taglist?: Array<{ tagid: number; tagname: string }>;
};

type WeComTagGetResponse = {
  errcode?: number;
  errmsg?: string;
  userlist?: Array<{ userid?: string }>;
};

export const defaultRoleTagMapping: Record<UserRole, string[]> = {
  super_admin: ["HY_ROLE_SUPER_ADMIN"],
  finance: ["HY_ROLE_FINANCE"],
  manager: ["HY_ROLE_MANAGER"],
  site_manager: ["HY_ROLE_SITE_MANAGER"],
  operator: ["HY_ROLE_OPERATOR"]
};

export const rolePriority: UserRole[] = [
  "super_admin",
  "finance",
  "manager",
  "site_manager",
  "operator"
];

export const parseRoleTagMapping = (raw: string | undefined): Record<UserRole, string[]> => {
  if (!raw?.trim()) return defaultRoleTagMapping;

  const parsed: Record<UserRole, string[]> = {
    super_admin: [],
    finance: [],
    manager: [],
    site_manager: [],
    operator: []
  };

  raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [roleRaw, tagsRaw] = item.split(":");
      const role = (roleRaw || "").trim() as UserRole;
      if (!rolePriority.includes(role)) return;
      const tags = (tagsRaw || "")
        .split("|")
        .map((tag) => tag.trim())
        .filter(Boolean);
      if (tags.length > 0) {
        parsed[role] = tags;
      }
    });

  return {
    super_admin:
      parsed.super_admin.length > 0 ? parsed.super_admin : defaultRoleTagMapping.super_admin,
    finance: parsed.finance.length > 0 ? parsed.finance : defaultRoleTagMapping.finance,
    manager: parsed.manager.length > 0 ? parsed.manager : defaultRoleTagMapping.manager,
    site_manager:
      parsed.site_manager.length > 0 ? parsed.site_manager : defaultRoleTagMapping.site_manager,
    operator: parsed.operator.length > 0 ? parsed.operator : defaultRoleTagMapping.operator
  };
};

export const fetchWeComTags = async (
  env: Env,
  accessToken: string
): Promise<Array<{ tagid: number; tagname: string }>> => {
  const json = await fetchWeComJson<WeComTagListResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/list?access_token=${encodeURIComponent(accessToken)}`
  );
  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, "Failed to fetch WeCom tags"));
  }
  return json.taglist ?? [];
};

export const isUserInTag = async (
  env: Env,
  accessToken: string,
  tagId: number,
  userId: string
): Promise<boolean> => {
  const json = await fetchWeComJson<WeComTagGetResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/get?access_token=${encodeURIComponent(accessToken)}&tagid=${tagId}`
  );
  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, `Failed to get members by WeCom tag ${tagId}`));
  }
  return (json.userlist ?? []).some((user) => user.userid === userId);
};

export const listUsersInTag = async (
  env: Env,
  accessToken: string,
  tagId: number
): Promise<Set<string>> => {
  const json = await fetchWeComJson<WeComTagGetResponse>(
    env,
    `https://qyapi.weixin.qq.com/cgi-bin/tag/get?access_token=${encodeURIComponent(accessToken)}&tagid=${tagId}`
  );
  if (json.errcode !== 0) {
    throw new Error(weComErrorMessage(json.errmsg, `Failed to get members by WeCom tag ${tagId}`));
  }
  const members = new Set<string>();
  (json.userlist ?? []).forEach((item) => {
    if (item.userid) members.add(item.userid);
  });
  return members;
};

/** 登录路径原有实现：按 rolePriority 顺序逐标签查成员，首个命中即返回。 */
export const resolveRoleByWeComTags = async (
  env: Env,
  accessToken: string,
  userId: string
): Promise<UserRole | undefined> => {
  const mapping = parseRoleTagMapping(env.WECHAT_ROLE_TAG_MAPPING);
  const tagList = await fetchWeComTags(env, accessToken);
  const tagIdByName = new Map<string, number>();
  tagList.forEach((item) => {
    tagIdByName.set(item.tagname, item.tagid);
  });

  for (const role of rolePriority) {
    const tagNames = mapping[role] || [];
    for (const tagName of tagNames) {
      const tagId = tagIdByName.get(tagName);
      if (!tagId) continue;
      const matched = await isUserInTag(env, accessToken, tagId, userId);
      if (matched) {
        return role;
      }
    }
  }

  return undefined;
};

/**
 * 供非登录场景（如超管配置校验）使用：自取 access_token，只按标签解析，
 * 不做 username 回退；不命中任何标签返回 null。
 */
export const resolveSystemRoleForUser = async (
  env: Env,
  userId: string
): Promise<UserRole | null> => {
  const accessToken = await fetchWeComAccessToken(env);
  const role = await resolveRoleByWeComTags(env, accessToken, userId);
  return role ?? null;
};
