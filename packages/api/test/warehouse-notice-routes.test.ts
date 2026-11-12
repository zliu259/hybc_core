import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 清单、任务、库房单的写接口成功后，往事件队列发哪条库房通知。

const authState = vi.hoisted(() => ({ sub: "lz", roles: ["operator"] }));

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: authState.sub,
    username: authState.sub,
    nickname: authState.sub,
    avatar: "",
    roles: authState.roles,
    permissions: [],
    tokenId: `token-${authState.sub}`,
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

type Harness = ReturnType<typeof createWarehouseHarness>;

describe.skipIf(!hasSqlite)("库房写接口发通知", () => {
  let h: Harness;

  const as = (sub: string, roles: string[]) => {
    authState.sub = sub;
    authState.roles = roles;
  };
  const call = (method: string, path: string, body?: unknown) =>
    callWh(h, mountWarehouseRoutes, method, path, body);
  const notices = () =>
    h.queued
      .filter((message: { type: string }) => message.type === "WAREHOUSE_NOTICE")
      .map((message: { payload: unknown }) => message.payload);
  const versionOf = (table: string, id: number): number =>
    Number(
      (
        h.database.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id) as {
          version: number;
        }
      ).version
    );

  beforeEach(() => {
    h = createWarehouseHarness();
    h.seed.member("lz", "keeper");
    as("lz", ["operator"]);
  });

  const draftKit = (managerUserid: string) => {
    const project = h.seed.project("一号工程", managerUserid);
    return h.seed.kit(
      { project_id: project, status: "draft", confirmed_at: null, confirmed_by_userid: null },
      [{ line_kind: "text", name_text: "记得带图纸", planned_qty: 0 }]
    );
  };

  it("现场负责人提交清单发待确认；库管确认发已确认", async () => {
    const kitId = draftKit("zhang");
    as("zhang", ["site_manager"]);
    const submitted = await call("POST", `/warehouse/kit/${kitId}/submit`, { version: 0 });
    expect(submitted.status).toBe(200);
    expect(notices()).toEqual([{ kind: "kit_submitted", kit_id: kitId, actor_userid: "zhang" }]);

    as("lz", ["operator"]);
    const confirmed = await call("POST", `/warehouse/kit/${kitId}/confirm`, {
      version: versionOf("project_kit", kitId)
    });
    expect(confirmed.status).toBe(200);
    expect(notices()[1]).toEqual({ kind: "kit_confirmed", kit_id: kitId, actor_userid: "lz" });
  });

  it("库管提交清单是直接确认，不发待确认", async () => {
    const kitId = draftKit("zhang");
    const submitted = await call("POST", `/warehouse/kit/${kitId}/submit`, { version: 0 });
    expect(submitted.body.data.status).toBe("confirmed");
    expect(notices()).toEqual([]);
  });

  it("建任务和派工各发一条派工通知", async () => {
    const created = await call("POST", "/warehouse/task", {
      kind: "other",
      title: "整理库房",
      assignee_userid: "wang"
    });
    expect(created.status).toBe(201);
    const taskId = created.body.data.id;
    expect(notices()).toEqual([{ kind: "tasks_assigned", task_ids: [taskId], actor_userid: "lz" }]);

    const assigned = await call("POST", `/warehouse/task/${taskId}/assign`, {
      version: versionOf("wh_task", taskId),
      assignee_userid: "zhao"
    });
    expect(assigned.status).toBe(200);
    expect(notices()).toHaveLength(2);
    expect(notices()[1]).toEqual({
      kind: "tasks_assigned",
      task_ids: [taskId],
      actor_userid: "lz"
    });
  });

  it("执行人提交发待确认；库管确认不合格的检查发维修任务通知", async () => {
    const device = h.seed.device();
    const taskId = h.seed.task({ kind: "inspection", device_id: device, assignee_userid: "wang" });
    as("wang", ["operator"]);
    const submitted = await call("POST", `/warehouse/task/${taskId}/submit`, {
      version: 0,
      result: "fail",
      result_note: "主轴漏油"
    });
    expect(submitted.body.data.status).toBe("submitted");
    expect(notices()).toEqual([{ kind: "task_submitted", task_id: taskId, actor_userid: "wang" }]);

    as("lz", ["operator"]);
    const confirmed = await call("POST", `/warehouse/task/${taskId}/confirm`, {
      version: versionOf("wh_task", taskId)
    });
    const followup = confirmed.body.data.followup_task_id;
    expect(followup).toBeGreaterThan(0);
    expect(notices()[1]).toEqual({ kind: "repair_created", task_id: followup, actor_userid: "lz" });
  });

  it("库管自己做不合格的检查：不发待确认，只发维修任务通知", async () => {
    const device = h.seed.device();
    const taskId = h.seed.task({ kind: "inspection", device_id: device, assignee_userid: "lz" });
    const submitted = await call("POST", `/warehouse/task/${taskId}/submit`, {
      version: 0,
      result: "fail",
      result_note: "主轴漏油"
    });
    expect(submitted.body.data.status).toBe("done");
    expect(notices()).toEqual([
      {
        kind: "repair_created",
        task_id: submitted.body.data.followup_task_id,
        actor_userid: "lz"
      }
    ]);
  });

  it("退回补充发给执行人", async () => {
    const taskId = h.seed.task({ status: "submitted", assignee_userid: "wang", kind: "other" });
    const sentBack = await call("POST", `/warehouse/task/${taskId}/send-back`, {
      version: 0,
      review_note: "补一张铭牌照片"
    });
    expect(sentBack.status).toBe(200);
    expect(notices()).toEqual([{ kind: "task_sent_back", task_id: taskId, actor_userid: "lz" }]);
  });

  it("取消任务不发通知", async () => {
    const taskId = h.seed.task({ assignee_userid: "wang", kind: "other" });
    const cancelled = await call("POST", `/warehouse/task/${taskId}/cancel`, {
      version: 0,
      reason: "不做了"
    });
    expect(cancelled.status).toBe(200);
    expect(notices()).toEqual([]);
  });

  it("发货发一条；同一个请求号重放不再发", async () => {
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const body = {
      doc_type: "out",
      client_request_id: "route-out-1",
      project_id: project,
      material_lines: [{ material_id: pipe, quantity: 4 }]
    };
    const first = await call("POST", "/warehouse/doc", body);
    expect(first.status).toBe(201);
    expect(notices()).toEqual([
      { kind: "doc_posted", doc_id: first.body.data.id, actor_userid: "lz" }
    ]);

    const replay = await call("POST", "/warehouse/doc", body);
    expect(replay.status).toBe(200);
    expect(notices()).toHaveLength(1);
  });

  it("返库带设备：发库房单通知，再发检查任务的派工通知", async () => {
    const project = h.seed.project("一号工程", "zhang");
    const device = h.seed.device({ location: "project", current_project_id: project });
    const back = await call("POST", "/warehouse/doc", {
      doc_type: "back",
      client_request_id: "route-back-1",
      project_id: project,
      device_lines: [{ device_id: device }]
    });
    expect(back.status).toBe(201);
    expect(back.body.data.created_task_ids).toHaveLength(1);
    expect(notices()).toEqual([
      { kind: "doc_posted", doc_id: back.body.data.id, actor_userid: "lz" },
      { kind: "tasks_assigned", task_ids: back.body.data.created_task_ids, actor_userid: "lz" }
    ]);
  });

  it("入库也发库房单事件（投递时再决定不通知）", async () => {
    const pipe = h.seed.material({ quantity: 0 });
    const inbound = await call("POST", "/warehouse/doc", {
      doc_type: "inbound",
      client_request_id: "route-in-1",
      material_lines: [{ material_id: pipe, quantity: 5 }]
    });
    expect(inbound.status).toBe(201);
    expect(notices()).toEqual([
      { kind: "doc_posted", doc_id: inbound.body.data.id, actor_userid: "lz" }
    ]);
  });

  it("冲销发冲销单的通知", async () => {
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const out = await call("POST", "/warehouse/doc", {
      doc_type: "out",
      client_request_id: "route-out-2",
      project_id: project,
      material_lines: [{ material_id: pipe, quantity: 4 }]
    });
    const reversed = await call("POST", `/warehouse/doc/${out.body.data.id}/reverse`, {
      client_request_id: "route-reverse-2",
      reason: "录错了"
    });
    expect(reversed.status).toBe(201);
    expect(reversed.body.data.id).not.toBe(out.body.data.id);
    expect(notices()[1]).toEqual({
      kind: "doc_posted",
      doc_id: reversed.body.data.id,
      actor_userid: "lz"
    });
  });

  it("队列坏了不影响写入", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.env.EVENT_QUEUE.send = async () => {
      throw new Error("queue down");
    };
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const out = await call("POST", "/warehouse/doc", {
      doc_type: "out",
      client_request_id: "route-out-3",
      project_id: project,
      material_lines: [{ material_id: pipe, quantity: 4 }]
    });
    expect(out.status).toBe(201);
    const stock = h.database.prepare("SELECT quantity FROM material WHERE id = ?").get(pipe) as {
      quantity: number;
    };
    expect(stock.quantity).toBe(6);
    consoleWarn.mockRestore();
  });

  it("写入失败时不发通知", async () => {
    const project = h.seed.project("一号工程", "zhang");
    const pipe = h.seed.material({ kind: "turnover", quantity: 1 });
    const out = await call("POST", "/warehouse/doc", {
      doc_type: "out",
      client_request_id: "route-out-4",
      project_id: project,
      material_lines: [{ material_id: pipe, quantity: 4 }]
    });
    expect(out.status).toBe(400);
    expect(notices()).toEqual([]);
  });
});
