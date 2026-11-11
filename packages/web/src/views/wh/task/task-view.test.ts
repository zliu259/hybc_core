import { describe, expect, it } from "vitest";

import type { TaskRow } from "@/api/wh/types";
import {
  beijingToday,
  isConflictError,
  isOverdue,
  parseTaskFilter,
  photoProgress,
  taskActions,
  taskFilterQuery
} from "./task-view";

const task = (patch: Partial<TaskRow> = {}): TaskRow => ({
  id: 1,
  task_no: "KFR-20261111-0001",
  kind: "inspection",
  source: "return",
  device_id: 1,
  device_code: "SB-0001",
  device_name: "唐兴",
  title: "返库检查：唐兴",
  description: null,
  systems_json: null,
  blocking: 1,
  required_photo_count: 3,
  due_date: "2026-11-13",
  assignee_userid: "worker",
  status: "todo",
  result: null,
  result_note: null,
  review_note: null,
  supplement_round: 0,
  parent_task_id: null,
  done_at: null,
  cancel_reason: null,
  version: 0,
  photo_count: 0,
  created_at: "2026-11-11T07:00:00.000Z",
  ...patch
});

describe("任务页筛选", () => {
  it("待派工和待执行都是 todo，用 assigned 区分", () => {
    expect(taskFilterQuery("unassigned")).toEqual({
      status: "todo",
      assigned: "no"
    });
    expect(taskFilterQuery("assigned")).toEqual({
      status: "todo",
      assigned: "yes"
    });
    expect(taskFilterQuery("submitted")).toEqual({ status: "submitted" });
    expect(taskFilterQuery("")).toEqual({});
  });

  it("地址里的筛选值不认识时当作不筛选", () => {
    expect(parseTaskFilter("submitted")).toBe("submitted");
    expect(parseTaskFilter("todo")).toBe("");
    expect(parseTaskFilter(undefined)).toBe("");
    expect(parseTaskFilter(["done"])).toBe("");
  });
});

describe("超期", () => {
  it("北京时间的今天：UTC 16:30 已经是第二天", () => {
    expect(beijingToday(new Date("2026-11-11T16:30:00.000Z"))).toBe(
      "2026-11-12"
    );
  });

  it("期限早于今天且没结束才算超期", () => {
    expect(isOverdue(task({ due_date: "2026-11-10" }), "2026-11-11")).toBe(
      true
    );
    expect(isOverdue(task({ due_date: "2026-11-11" }), "2026-11-11")).toBe(
      false
    );
    expect(
      isOverdue(
        task({ due_date: "2026-11-10", status: "submitted" }),
        "2026-11-11"
      )
    ).toBe(true);
    expect(
      isOverdue(task({ due_date: "2026-11-10", status: "done" }), "2026-11-11")
    ).toBe(false);
    expect(isOverdue(task({ due_date: null }), "2026-11-11")).toBe(false);
  });
});

describe("按钮", () => {
  it("执行人在待执行时能传照片和提交；库管不能替别人提交", () => {
    expect(taskActions(task(), { userid: "worker", isKeeper: false })).toEqual({
      canWork: true,
      canAssign: false,
      canReview: false,
      canCancel: false
    });
    expect(taskActions(task(), { userid: "keeper", isKeeper: true })).toEqual({
      canWork: false,
      canAssign: true,
      canReview: false,
      canCancel: true
    });
  });

  it("待确认：库管能确认和退回，执行人不能再动", () => {
    const submitted = task({ status: "submitted" });
    expect(
      taskActions(submitted, { userid: "keeper", isKeeper: true })
    ).toEqual({
      canWork: false,
      canAssign: false,
      canReview: true,
      canCancel: true
    });
    expect(
      taskActions(submitted, { userid: "worker", isKeeper: false }).canWork
    ).toBe(false);
  });

  it("已结束的任务什么都不能做", () => {
    const done = task({ status: "done" });
    expect(taskActions(done, { userid: "keeper", isKeeper: true })).toEqual({
      canWork: false,
      canAssign: false,
      canReview: false,
      canCancel: false
    });
  });

  it("没派工时谁都不能提交", () => {
    expect(
      taskActions(task({ assignee_userid: null }), {
        userid: "worker",
        isKeeper: false
      }).canWork
    ).toBe(false);
  });
});

describe("其他", () => {
  it("照片进度：没有要求时只显示张数", () => {
    expect(photoProgress(task({ photo_count: 1 }))).toBe("1/3");
    expect(
      photoProgress(task({ photo_count: 2, required_photo_count: 0 }))
    ).toBe("2");
  });

  it("只有响应码 409 算数据已变化", () => {
    expect(isConflictError({ response: { status: 409 } })).toBe(true);
    expect(isConflictError({ response: { status: 400 } })).toBe(false);
    expect(isConflictError(new Error("network"))).toBe(false);
    expect(isConflictError(null)).toBe(false);
  });
});
