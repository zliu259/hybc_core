import { describe, expect, it } from "vitest";
import {
  buildFallbackReviewerNotice,
  filterSuperAdminContacts
} from "./ai-gate-settings";

describe("filterSuperAdminContacts", () => {
  it("只保留 system_role 为 super_admin 的联系人并按姓名排序", () => {
    const result = filterSuperAdminContacts([
      { userid: "b", name: "王", department: [1], system_role: "super_admin" },
      { userid: "m", name: "李", department: [1], system_role: "manager" },
      { userid: "a", name: "刘", department: [1], system_role: "super_admin" },
      { userid: "n", name: "无角色", department: [1] }
    ]);
    expect(result.map(u => u.userid)).toEqual(["a", "b"]);
  });
});

describe("buildFallbackReviewerNotice", () => {
  it("未配置给黄色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "",
        fallback_reviewer_name: null,
        fallback_reviewer_role: null,
        role_check_error: null
      })
    ).toEqual({
      type: "warning",
      text: "未配置兜底审核人，AI 拦截将退回发起人修改重提"
    });
  });

  it("角色不再是超管时给黄色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: "manager",
        role_check_error: null
      })
    ).toEqual({
      type: "warning",
      text: "当前兜底审核人 刘老板 的角色已不是超级管理员（manager），请重新指定"
    });
  });

  it("角色无法核对时提示但不判定失效", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: null,
        role_check_error: "wecom timeout"
      })
    ).toEqual({
      type: "warning",
      text: "暂时无法核对 刘老板 的角色（企业微信接口不可用），当前配置仍然生效"
    });
  });

  it("正常配置给绿色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: "super_admin",
        role_check_error: null
      })
    ).toEqual({
      type: "success",
      text: "AI 拦截将转给 刘老板 人工复核"
    });
  });
});
