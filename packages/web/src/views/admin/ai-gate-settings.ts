import type { WeComUser } from "@/api/wecom";

export type AiGateFallbackReviewerSettings = {
  fallback_reviewer_userid: string;
  fallback_reviewer_name: string | null;
  fallback_reviewer_role: string | null;
  role_check_error: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
};

/** 设置卡下拉人选：只列超管，按姓名排序。 */
export const filterSuperAdminContacts = (users: WeComUser[]): WeComUser[] =>
  users
    .filter(user => user.system_role === "super_admin")
    .sort((a, b) =>
      `${a.name || ""}`.localeCompare(`${b.name || ""}`, "zh-Hans-CN")
    );

export const buildFallbackReviewerNotice = (
  settings: AiGateFallbackReviewerSettings
): { type: "warning" | "success"; text: string } => {
  if (!settings.fallback_reviewer_userid) {
    return {
      type: "warning",
      text: "未配置兜底审核人，AI 拦截将退回发起人修改重提"
    };
  }
  const name =
    settings.fallback_reviewer_name || settings.fallback_reviewer_userid;
  if (settings.role_check_error) {
    return {
      type: "warning",
      text: `暂时无法核对 ${name} 的角色（企业微信接口不可用），当前配置仍然生效`
    };
  }
  if (settings.fallback_reviewer_role !== "super_admin") {
    return {
      type: "warning",
      text: `当前兜底审核人 ${name} 的角色已不是超级管理员（${settings.fallback_reviewer_role ?? "未命中角色标签"}），请重新指定`
    };
  }
  return { type: "success", text: `AI 拦截将转给 ${name} 人工复核` };
};
