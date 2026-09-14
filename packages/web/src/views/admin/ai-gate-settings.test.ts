import { describe, expect, it } from "vitest";
import type { WeComUser } from "@/api/wecom";
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

  it("不改动传入的数组", () => {
    const users: WeComUser[] = [
      { userid: "b", name: "王", department: [1], system_role: "super_admin" },
      { userid: "m", name: "李", department: [1], system_role: "manager" },
      { userid: "a", name: "刘", department: [1], system_role: "super_admin" }
    ];
    filterSuperAdminContacts(users);
    expect(users.map(u => u.userid)).toEqual(["b", "m", "a"]);
  });
});

describe("buildFallbackReviewerNotice", () => {
  it("未配置给黄色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "",
        fallback_reviewer_name: null,
        fallback_reviewer_role: null,
        role_check_error: null,
        contact_check_error: null
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
        role_check_error: null,
        contact_check_error: null
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
        role_check_error: "wecom timeout",
        contact_check_error: null
      })
    ).toEqual({
      type: "warning",
      text: "暂时无法核对 刘老板 的角色（企业微信接口不可用），当前配置仍然生效"
    });
  });

  it("角色核对出不合格时，通讯录不可用不掩盖角色问题", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: null,
        fallback_reviewer_role: "manager",
        role_check_error: null,
        contact_check_error: "kv down"
      })
    ).toEqual({
      type: "warning",
      text: "当前兜底审核人 Boss 的角色已不是超级管理员（manager），请重新指定"
    });
  });

  it("通讯录读不到但角色核对通过时只说读不到姓名", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: null,
        fallback_reviewer_role: "super_admin",
        role_check_error: null,
        contact_check_error: "wecom 500"
      })
    ).toEqual({
      type: "warning",
      text: "暂时无法读取通讯录（企业微信接口不可用），只能显示兜底审核人工号 Boss，当前配置仍然生效"
    });
  });

  it("正常配置给绿色提示", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: "刘老板",
        fallback_reviewer_role: "super_admin",
        role_check_error: null,
        contact_check_error: null
      })
    ).toEqual({
      type: "success",
      text: "AI 拦截将转给 刘老板（超级管理员）人工复核"
    });
  });

  it("通讯录里查不到姓名但没报错时回落到工号", () => {
    expect(
      buildFallbackReviewerNotice({
        fallback_reviewer_userid: "Boss",
        fallback_reviewer_name: null,
        fallback_reviewer_role: "super_admin",
        role_check_error: null,
        contact_check_error: null
      })
    ).toEqual({
      type: "success",
      text: "AI 拦截将转给 Boss（超级管理员）人工复核"
    });
  });
});
