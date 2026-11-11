import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { generateSerials } from "../src/services/serial";
import { getDevice } from "../src/services/warehouse/device";
import { isGuardFailure } from "../src/services/warehouse/guard";
import {
  addTaskPhoto,
  assignTask,
  cancelTask,
  confirmTask,
  createTask,
  getTask,
  listTasks,
  removeTaskPhoto,
  sendBackTask,
  submitTask
} from "../src/services/warehouse/task";
import { authPayload, callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({ sub: "worker", roles: ["operator"] }));

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

const KEEPER_CAPS = {
  is_keeper: true,
  is_doc_admin: true,
  can_scrap: false,
  can_unscrap: false,
  can_manage_settings: false,
  can_create_kit: true
};
const WORKER_CAPS = {
  ...KEEPER_CAPS,
  is_keeper: false,
  is_doc_admin: false,
  can_create_kit: false
};
const keeper = authPayload("keeper", ["operator"]);
const worker = authPayload("worker", ["operator"]);

describe.skipIf(!hasSqlite)("库房任务", () => {
  let h;
  let deviceId;

  beforeEach(() => {
    h = createWarehouseHarness();
    deviceId = h.seed.device({ name: "唐兴 NSPD1200" });
    authState.sub = "worker";
    authState.roles = ["operator"];
  });

  const newTask = (patch = {}) =>
    createTask(
      h.env,
      { kind: "inspection", title: "返库检查", device_id: deviceId, ...patch },
      "keeper"
    );

  const addPhotos = async (id, count, actor = worker, caps = WORKER_CAPS) => {
    for (let i = 0; i < count; i += 1) {
      await addTaskPhoto(h.env, id, { file_key: `wh-task/p-${id}-${i}.jpg` }, actor, caps);
    }
  };

  it("检查和维修默认阻塞，保养和其他默认不阻塞；任务号前缀 KFR", async () => {
    const results = [];
    for (const kind of ["inspection", "maintenance", "servicing", "other"]) {
      const { id, task_no } = await newTask({ kind, title: kind });
      expect(task_no).toMatch(/^KFR-\d{8}-\d{4}$/);
      results.push((await getTask(h.env, id)).blocking);
    }
    expect(results).toEqual([1, 1, 0, 0]);
    const overridden = await newTask({ kind: "servicing", blocking: true });
    expect((await getTask(h.env, overridden.id)).blocking).toBe(1);
  });

  it.each([
    [{ kind: "audit" }, "任务类型不对"],
    [{ title: "" }, "任务标题不能为空"],
    [{ device_id: 999 }, "设备不存在"],
    [{ required_photo_count: 10 }, "照片要求必须是 0 到 9 之间的整数"]
  ])("新建时拒绝 %j", async (patch, message) => {
    await expect(newTask(patch)).rejects.toMatchObject({ status: 400, message });
  });

  it("派工：只能改待执行的任务，版本号不对时批内断言失败", async () => {
    const { id } = await newTask();
    await assignTask(h.env, id, { assignee_userid: "worker", version: 0 }, "keeper");
    expect(await getTask(h.env, id)).toMatchObject({ assignee_userid: "worker", version: 1 });
    await expect(
      assignTask(h.env, id, { assignee_userid: "u2", version: 0 }, "keeper")
    ).rejects.toSatisfy(isGuardFailure);
  });

  it("照片不够不能提交", async () => {
    const { id } = await newTask({ required_photo_count: 3 });
    await assignTask(h.env, id, { assignee_userid: "worker", version: 0 }, "keeper");
    await addPhotos(id, 1);
    await expect(
      submitTask(
        h.env,
        id,
        { result: "pass", result_note: "正常", version: 1 },
        worker,
        WORKER_CAPS
      )
    ).rejects.toMatchObject({ status: 400, message: "还差 2 张照片" });
  });

  it("检查任务不选结果不能提交；维修任务不选系统不能提交；简报必填", async () => {
    const inspection = await newTask();
    await expect(
      submitTask(h.env, inspection.id, { result_note: "看过", version: 0 }, keeper, KEEPER_CAPS)
    ).rejects.toMatchObject({
      message: "检查结果不对"
    });
    await expect(
      submitTask(h.env, inspection.id, { result: "pass", version: 0 }, keeper, KEEPER_CAPS)
    ).rejects.toMatchObject({
      message: "简报不能为空"
    });
    const repair = await newTask({ kind: "maintenance", title: "维修" });
    await expect(
      submitTask(
        h.env,
        repair.id,
        { result_note: "修好了", systems: [], version: 0 },
        keeper,
        KEEPER_CAPS
      )
    ).rejects.toMatchObject({ message: "请选择维修涉及的系统" });
    await expect(
      submitTask(
        h.env,
        repair.id,
        { result_note: "修好了", systems: ["engine"], version: 0 },
        keeper,
        KEEPER_CAPS
      )
    ).rejects.toMatchObject({ message: "请选择维修涉及的系统" });
  });

  it("执行人不是库管：提交后待确认，确认后完成", async () => {
    const { id } = await newTask({ required_photo_count: 1 });
    await assignTask(h.env, id, { assignee_userid: "worker", version: 0 }, "keeper");
    await addPhotos(id, 1);
    expect(
      await submitTask(
        h.env,
        id,
        { result: "pass", result_note: "正常", version: 1 },
        worker,
        WORKER_CAPS
      )
    ).toEqual({
      status: "submitted",
      followup_task_id: null
    });
    expect(await getTask(h.env, id)).toMatchObject({
      status: "submitted",
      result: "pass",
      photo_count: 1
    });
    expect((await getDevice(h.env, deviceId)).state).toBe("pending_inspection");
    await confirmTask(h.env, id, { version: 2 }, "keeper");
    expect(await getTask(h.env, id)).toMatchObject({ status: "done", done_by_userid: "keeper" });
    const device = await getDevice(h.env, deviceId);
    expect(device.state).toBe("available");
    expect(device.events[0]).toMatchObject({ event_type: "task_done", summary: "检查合格" });
  });

  it("执行人是库管：提交即完成", async () => {
    const { id } = await newTask({ kind: "servicing", title: "换机油" });
    expect(
      await submitTask(h.env, id, { result_note: "已换", version: 0 }, keeper, KEEPER_CAPS)
    ).toEqual({
      status: "done",
      followup_task_id: null
    });
    expect((await getDevice(h.env, deviceId)).events[0].summary).toBe("换机油已完成");
  });

  it("检查不合格完成时生成阻塞的维修任务，设备显示维修中", async () => {
    const { id } = await newTask();
    const { followup_task_id } = await submitTask(
      h.env,
      id,
      { result: "fail", result_note: "主轴漏油", version: 0 },
      keeper,
      KEEPER_CAPS
    );
    const followup = await getTask(h.env, followup_task_id);
    expect(followup).toMatchObject({
      kind: "maintenance",
      source: "followup",
      blocking: 1,
      status: "todo",
      assignee_userid: null,
      parent_task_id: id,
      required_photo_count: 3,
      title: "维修：唐兴 NSPD1200"
    });
    const device = await getDevice(h.env, deviceId);
    expect(device.state).toBe("repairing");
    expect(device.events[0].summary).toBe("检查不合格，已转维修");
  });

  it("检查合格完成后设备回到可用", async () => {
    const { id } = await newTask();
    await submitTask(
      h.env,
      id,
      { result: "pass", result_note: "正常", version: 0 },
      keeper,
      KEEPER_CAPS
    );
    expect((await getDevice(h.env, deviceId)).state).toBe("available");
  });

  it("维修任务记录涉及的系统", async () => {
    const { id } = await newTask({ kind: "maintenance", title: "维修" });
    await submitTask(
      h.env,
      id,
      { result_note: "换密封圈", systems: ["hydraulic", "drive"], version: 0 },
      keeper,
      KEEPER_CAPS
    );
    expect(JSON.parse((await getTask(h.env, id)).systems_json)).toEqual(["hydraulic", "drive"]);
  });

  it("退回补充：必须写要求，回到待执行，轮次加一，照片保留", async () => {
    const { id } = await newTask({ required_photo_count: 1 });
    await assignTask(h.env, id, { assignee_userid: "worker", version: 0 }, "keeper");
    await addPhotos(id, 1);
    await submitTask(
      h.env,
      id,
      { result: "pass", result_note: "正常", version: 1 },
      worker,
      WORKER_CAPS
    );
    await expect(
      sendBackTask(h.env, id, { review_note: " ", version: 2 }, "keeper")
    ).rejects.toMatchObject({
      message: "退回要求不能为空"
    });
    await sendBackTask(h.env, id, { review_note: "补拍铭牌", version: 2 }, "keeper");
    expect(await getTask(h.env, id)).toMatchObject({
      status: "todo",
      review_note: "补拍铭牌",
      supplement_round: 1,
      photo_count: 1,
      result_note: "正常"
    });
  });

  it("取消阻塞任务后设备回到可用，并写时间线", async () => {
    const { id } = await newTask();
    expect((await getDevice(h.env, deviceId)).state).toBe("pending_inspection");
    await expect(cancelTask(h.env, id, { reason: "", version: 0 }, "keeper")).rejects.toMatchObject(
      { message: "取消原因不能为空" }
    );
    await cancelTask(h.env, id, { reason: "急用，先发出", version: 0 }, "keeper");
    const device = await getDevice(h.env, deviceId);
    expect(device.state).toBe("available");
    expect(device.events[0]).toMatchObject({
      event_type: "task_cancelled",
      summary: "任务取消：急用，先发出"
    });
    await expect(
      cancelTask(h.env, id, { reason: "再取消", version: 1 }, "keeper")
    ).rejects.toMatchObject({ status: 409 });
  });

  it("别人上传的照片不能删；已提交的任务不能删照片；照片文件必须是任务照片", async () => {
    const { id } = await newTask({ required_photo_count: 1 });
    await assignTask(h.env, id, { assignee_userid: "worker", version: 0 }, "keeper");
    const mine = await addTaskPhoto(h.env, id, { file_key: "wh-task/a.jpg" }, worker, WORKER_CAPS);
    const theirs = await addTaskPhoto(
      h.env,
      id,
      { file_key: "wh-task/b.jpg" },
      keeper,
      KEEPER_CAPS
    );
    await expect(
      addTaskPhoto(h.env, id, { file_key: "legacy/fin/x.pdf" }, worker, WORKER_CAPS)
    ).rejects.toMatchObject({
      status: 400
    });
    await expect(removeTaskPhoto(h.env, id, theirs.id, worker)).rejects.toMatchObject({
      status: 403
    });
    await removeTaskPhoto(h.env, id, mine.id, worker);
    expect((await getTask(h.env, id)).photos.map((p) => p.file_key)).toEqual(["wh-task/b.jpg"]);
    await submitTask(
      h.env,
      id,
      { result: "pass", result_note: "正常", version: 1 },
      worker,
      WORKER_CAPS
    );
    await expect(removeTaskPhoto(h.env, id, theirs.id, keeper)).rejects.toMatchObject({
      status: 409
    });
  });

  it("非执行人不能加照片也不能提交", async () => {
    const { id } = await newTask();
    await assignTask(h.env, id, { assignee_userid: "someone", version: 0 }, "keeper");
    await expect(
      addTaskPhoto(h.env, id, { file_key: "wh-task/a.jpg" }, worker, WORKER_CAPS)
    ).rejects.toMatchObject({
      status: 403,
      message: "只有执行人可以操作"
    });
    await expect(
      submitTask(h.env, id, { result: "pass", result_note: "x", version: 1 }, worker, WORKER_CAPS)
    ).rejects.toMatchObject({
      status: 403
    });
  });

  it("列表：我的任务只看自己的，未完成的排前面", async () => {
    const a = await newTask({ title: "A" });
    const b = await newTask({ title: "B" });
    await assignTask(h.env, b.id, { assignee_userid: "worker", version: 0 }, "keeper");
    await cancelTask(h.env, a.id, { reason: "不用了", version: 0 }, "keeper");
    expect((await listTasks(h.env, { scope: "mine" }, "worker")).items.map((t) => t.title)).toEqual(
      ["B"]
    );
    const all = await listTasks(h.env, { scope: "all" }, "worker");
    expect(all.items.map((t) => t.title)).toEqual(["B", "A"]);
    expect(all.items[0]).toMatchObject({
      device_code: expect.any(String),
      device_name: "唐兴 NSPD1200",
      photo_count: 0
    });
  });

  it("generateSerials 一次返回连续的号", async () => {
    const serials = await generateSerials(h.env.DB, "KFR", "wh_task", "task_no", 3);
    expect(serials).toEqual([
      expect.stringMatching(/^KFR-\d{8}-0001$/),
      expect.stringMatching(/^KFR-\d{8}-0002$/),
      expect.stringMatching(/^KFR-\d{8}-0003$/)
    ]);
  });

  it("接口：操作员提交别人的任务 403，库管能确认，版本冲突 409", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    h.seed.member("keeper", "keeper");
    authState.sub = "keeper";
    const created = await call("POST", "/warehouse/task", {
      kind: "inspection",
      title: "检查",
      device_id: deviceId
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(
      (
        await call("POST", `/warehouse/task/${id}/assign`, {
          assignee_userid: "worker",
          version: 0
        })
      ).status
    ).toBe(200);
    expect(
      (
        await call("POST", `/warehouse/task/${id}/assign`, {
          assignee_userid: "worker",
          version: 0
        })
      ).body
    ).toEqual({
      success: false,
      error: { message: "数据已变化，请刷新后重试" }
    });

    authState.sub = "intruder";
    expect(
      (
        await call("POST", `/warehouse/task/${id}/submit`, {
          result: "pass",
          result_note: "x",
          version: 1
        })
      ).status
    ).toBe(403);

    authState.sub = "worker";
    expect(
      (await call("POST", `/warehouse/task/${id}/assign`, { assignee_userid: "x", version: 1 }))
        .status
    ).toBe(403);
    const submitted = await call("POST", `/warehouse/task/${id}/submit`, {
      result: "pass",
      result_note: "正常",
      version: 1
    });
    expect(submitted).toMatchObject({ status: 200, body: { data: { status: "submitted" } } });

    authState.sub = "keeper";
    expect((await call("POST", `/warehouse/task/${id}/confirm`, { version: 2 })).status).toBe(200);
    const detail = await call("GET", `/warehouse/task/${id}`);
    expect(detail.body.data).toMatchObject({ status: "done", photos: [] });
    const mine = await call("GET", "/warehouse/task?scope=mine");
    expect(mine.body.pagination.total).toBe(0);
  });
});
