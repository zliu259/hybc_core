import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { INSTRUCTIONS } from "./instructions";

const SKILL = readFileSync(fileURLToPath(new URL("../SKILL.md", import.meta.url)), "utf8");

/**
 * 终审 MEDIUM 4：check_pending 的完整状态集是 7 种，之前只列了 4 种。
 * 漏掉的 failed 最危险——它意味着重放执行失败、结果未知、【可能已经落库】。
 */
const ALL_STATUSES = [
  "pending",
  "confirmed",
  "executing",
  "done",
  "failed",
  "rejected",
  "expired"
] as const;

describe("INSTRUCTIONS", () => {
  it("不再声称只读/没有写操作", () => {
    expect(INSTRUCTIONS).not.toContain("没有写操作");
    expect(INSTRUCTIONS).not.toContain("只提供【只读】");
  });

  it("列出全部 7 种待确认状态", () => {
    for (const s of ALL_STATUSES) {
      expect(INSTRUCTIONS).toContain(s);
    }
  });

  it("讲清 failed 的歧义性：可能已落库，须让用户核对", () => {
    expect(INSTRUCTIONS).toContain("failed");
    expect(INSTRUCTIONS).toMatch(/failed[^\n]*可能[^\n]*落库|failed[^\n]*结果未知/);
    expect(INSTRUCTIONS).toContain("核对");
  });

  it("要求尽量提供 comment，并说明其以本人名义落库", () => {
    expect(INSTRUCTIONS).toContain("comment");
    expect(INSTRUCTIONS).toContain("本人名义");
  });

  it("禁止代替用户确认", () => {
    expect(INSTRUCTIONS).toContain("绝不能");
    expect(INSTRUCTIONS).toContain("确认");
  });
});

describe("SKILL.md", () => {
  it("不再把自己框成纯只读", () => {
    expect(SKILL).not.toContain("当前**没有写操作**");
    expect(SKILL).not.toContain("# 恒越百川后台（只读）");
  });

  it("列出全部 7 种待确认状态", () => {
    for (const s of ALL_STATUSES) {
      expect(SKILL).toContain(s);
    }
  });

  it("讲清 failed 与 executing 的处理方式", () => {
    expect(SKILL).toMatch(/failed[^\n]*可能[^\n]*落库|failed[^\n]*结果未知/);
    expect(SKILL).toContain("executing");
  });

  it("要求尽量提供 comment 并说明落库署名", () => {
    expect(SKILL).toContain("comment");
    expect(SKILL).toContain("本人名义");
  });
});
