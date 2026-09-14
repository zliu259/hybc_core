import type { ApprovalAiGateSettings } from "@/api/admin";
import type { WeComUser } from "@/api/wecom";

/** 提示文案只依赖设置接口这几个字段，直接从 API 类型取，避免两处定义漂移。 */
export type FallbackReviewerNoticeInput = Pick<
  ApprovalAiGateSettings,
  | "fallback_reviewer_userid"
  | "fallback_reviewer_name"
  | "fallback_reviewer_role"
  | "role_check_error"
  | "contact_check_error"
>;

/** 设置卡下拉人选：只列超管，按姓名排序。 */
export const filterSuperAdminContacts = (users: WeComUser[]): WeComUser[] =>
  users
    .filter(user => user.system_role === "super_admin")
    .sort((a, b) =>
      `${a.name || ""}`.localeCompare(`${b.name || ""}`, "zh-Hans-CN")
    );

export const buildFallbackReviewerNotice = (
  settings: FallbackReviewerNoticeInput
): { type: "warning" | "success"; text: string } => {
  if (!settings.fallback_reviewer_userid) {
    return {
      type: "warning",
      text: "未配置兜底审核人，AI 拦截将退回发起人修改重提"
    };
  }
  const name =
    settings.fallback_reviewer_name || settings.fallback_reviewer_userid;
  // 角色「核对不了」(role_check_error) 优先于一切：企微不可用时角色为空，不能当成被降权；
  // 但角色一旦核对出来不合格，就要先报角色，不能被通讯录读不到姓名掩盖过去。
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
  if (settings.contact_check_error && !settings.fallback_reviewer_name) {
    return {
      type: "warning",
      text: `暂时无法读取通讯录（企业微信接口不可用），只能显示兜底审核人工号 ${settings.fallback_reviewer_userid}，当前配置仍然生效`
    };
  }
  return {
    type: "success",
    text: `AI 拦截将转给 ${name}（超级管理员）人工复核`
  };
};
