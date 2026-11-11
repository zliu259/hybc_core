import { describe, expect, it } from "vitest";

import type { TaskRow } from "@/api/wh/types";
import { buildRepairGroups } from "./usage-view";

const doneTask: TaskRow = {
  id: 1,
  task_no: "KFR-20261111-0001",
  kind: "maintenance",
  source: "followup",
  device_id: 1,
  device_code: "SB-0001",
  device_name: "唐兴",
  title: "维修",
  description: null,
  systems_json: '["hydraulic"]',
  blocking: 1,
  required_photo_count: 0,
  due_date: null,
  assignee_userid: "u1",
  status: "done",
  result: null,
  result_note: "换密封圈",
  review_note: null,
  supplement_round: 0,
  parent_task_id: null,
  done_at: "2026-11-11T02:00:00.000Z",
  cancel_reason: null,
  version: 2,
  photo_count: 0,
  created_at: "2026-11-10T00:00:00.000Z"
};

describe("buildRepairGroups", () => {
  it("维修记录按系统分组，一个任务两个系统时两边都有", () => {
    const groups = buildRepairGroups([
      { ...doneTask, systems_json: '["hydraulic","drive"]' }
    ]);
    expect(groups.map(g => [g.label, g.entries.length])).toEqual([
      ["液压", 1],
      ["传动", 1]
    ]);
    expect(groups[0].entries[0]).toEqual({
      done_at: "2026-11-11T02:00:00.000Z",
      task_no: "KFR-20261111-0001",
      note: "换密封圈"
    });
  });

  it("组按 液压、电气、传动、其他 排序，组内按完成时间倒序", () => {
    const groups = buildRepairGroups([
      {
        ...doneTask,
        id: 1,
        systems_json: '["other","electric"]',
        done_at: "2026-11-01T00:00:00.000Z"
      },
      {
        ...doneTask,
        id: 2,
        task_no: "KFR-2",
        systems_json: '["electric"]',
        done_at: "2026-11-05T00:00:00.000Z"
      }
    ]);
    expect(groups.map(g => g.label)).toEqual(["电气", "其他"]);
    expect(groups[0].entries.map(e => e.task_no)).toEqual([
      "KFR-2",
      "KFR-20261111-0001"
    ]);
  });

  it("未完成和非维修的任务不出现；没有记录的系统不出现", () => {
    expect(
      buildRepairGroups([
        { ...doneTask, status: "todo" },
        { ...doneTask, kind: "inspection" }
      ])
    ).toEqual([]);
  });

  it("systems_json 不是合法 JSON 时归到 其他", () => {
    expect(
      buildRepairGroups([{ ...doneTask, systems_json: "oops" }]).map(
        g => g.label
      )
    ).toEqual(["其他"]);
  });
});
