import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { getDevice } from "../src/services/warehouse/device";
import { createWhDoc } from "../src/services/warehouse/doc";
import { isGuardFailure } from "../src/services/warehouse/guard";
import { getProjectHoldings } from "../src/services/warehouse/holdings";
import { getMaterial } from "../src/services/warehouse/material";
import { getTask } from "../src/services/warehouse/task";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({ sub: "keeper", roles: ["operator"] }));

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

let seq = 0;
const rid = () => `req-move-${String((seq += 1)).padStart(4, "0")}`;

describe.skipIf(!hasSqlite)("库房单：发货、返库、转场", () => {
  let h;
  let projectId;
  let otherProjectId;
  let deviceId;
  let pipe;
  let rod;

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200");
    otherProjectId = h.seed.project("安定 DN600");
    deviceId = h.seed.device({ device_code: "SB-0001", name: "唐兴 NSPD1200" });
    pipe = h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米", quantity: 200 });
    rod = h.seed.material({ name: "电焊条", spec: "J422", kind: "consumable", quantity: 50 });
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  const out = (patch = {}) =>
    createWhDoc(
      h.env,
      {
        doc_type: "out",
        client_request_id: rid(),
        project_id: projectId,
        handover_name: "张三",
        device_lines: [{ device_id: deviceId }],
        material_lines: [
          { material_id: pipe, quantity: 120 },
          { material_id: rod, quantity: 10 }
        ],
        ...patch
      },
      "keeper"
    );

  const holdingOf = async (pid, materialId) =>
    (await getProjectHoldings(h.env, pid)).materials.find((m) => m.material_id === materialId)
      ?.holding ?? 0;

  it("发货：设备到项目，周转件记到项目名下，耗材只扣库存", async () => {
    await out();
    const device = await getDevice(h.env, deviceId);
    expect(device).toMatchObject({
      location: "project",
      current_project_id: projectId,
      state: "on_project",
      version: 1
    });
    expect(device.events[0]).toMatchObject({
      event_type: "dispatched",
      summary: "发往临河 DN1200"
    });
    expect((await getMaterial(h.env, pipe)).quantity).toBe(80);
    expect((await getMaterial(h.env, rod)).quantity).toBe(40);
    const holdings = await getProjectHoldings(h.env, projectId);
    expect(holdings.devices.map((d) => d.device_code)).toEqual(["SB-0001"]);
    expect(holdings.materials).toEqual([
      {
        material_id: pipe,
        material_code: expect.any(String),
        name: "排泥钢管",
        spec: "Φ114",
        unit: "米",
        holding: 120
      }
    ]);
  });

  it("库存不足时整单失败，设备也没有动", async () => {
    await expect(
      out({ material_lines: [{ material_id: pipe, quantity: 210 }] })
    ).rejects.toMatchObject({
      status: 400,
      message: "库存不足：排泥钢管 Φ114，在库 200"
    });
    expect((await getDevice(h.env, deviceId)).location).toBe("warehouse");
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_doc").get().n).toBe(0);
  });

  it("有阻塞任务的设备不能发出，报错说明是哪种任务", async () => {
    h.seed.task({ device_id: deviceId, kind: "maintenance", status: "todo" });
    await expect(out({ material_lines: [] })).rejects.toMatchObject({
      status: 409,
      message: "SB-0001 有未完成的维修任务，不能发出"
    });
  });

  it("不在库的设备不能发出", async () => {
    await out({ material_lines: [] });
    await expect(out({ material_lines: [], project_id: otherProjectId })).rejects.toMatchObject({
      status: 409,
      message: "SB-0001 不在库"
    });
  });

  it("两个请求同时发同一台设备：后到的批内断言失败，什么都不写", async () => {
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let injected = false;
    h.env.DB.batch = async (statements) => {
      if (!injected) {
        injected = true;
        h.database
          .prepare("UPDATE device SET location = 'project', current_project_id = ? WHERE id = ?")
          .run(otherProjectId, deviceId);
      }
      return originalBatch(statements);
    };
    await expect(out()).rejects.toSatisfy(isGuardFailure);
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_doc").get().n).toBe(0);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(200);
    expect((await getDevice(h.env, deviceId)).current_project_id).toBe(otherProjectId);
  });

  it("返库：设备回库并待检，每台生成一个检查任务，顶进距离被记录", async () => {
    await out({ material_lines: [] });
    const result = await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: "req-back-001",
        occurred_at: "2026-11-11T02:00:00.000Z",
        device_lines: [{ device_id: deviceId, usage_meters: 320.5, soil_type: "砂卵石" }]
      },
      "keeper"
    );
    expect(result.created_task_ids).toHaveLength(1);
    expect(await getTask(h.env, result.created_task_ids[0])).toMatchObject({
      kind: "inspection",
      source: "return",
      blocking: 1,
      required_photo_count: 3,
      assignee_userid: "keeper",
      origin_doc_id: result.id,
      title: "返库检查：唐兴 NSPD1200",
      due_date: "2026-11-13"
    });
    expect(await getDevice(h.env, deviceId)).toMatchObject({
      location: "warehouse",
      current_project_id: null,
      state: "pending_inspection",
      usage_meters_total: 320.5,
      usage_records: [
        {
          doc_no: result.doc_no,
          project_name: "临河 DN1200",
          usage_meters: 320.5,
          soil_type: "砂卵石"
        }
      ]
    });
  });

  it("设备只有一个不挡发出的手工检查时，返库照样生成返库检查，设备待检", async () => {
    await out({ material_lines: [] });
    h.seed.task({ device_id: deviceId, kind: "inspection", blocking: 0, title: "顺便看看" });
    const result = await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: "req-back-nb-01",
        device_lines: [{ device_id: deviceId }]
      },
      "keeper"
    );
    expect(result.created_task_ids).toHaveLength(1);
    expect((await getDevice(h.env, deviceId)).state).toBe("pending_inspection");
  });

  it("设了默认检查人时任务派给他；设备已有未完成检查时不重复建", async () => {
    h.database
      .prepare(
        "INSERT INTO system_config (config_key, config_value, updated_by, created_at, updated_at) VALUES ('warehouse.default_inspector_userid', 'inspector', 'x', 'n', 'n')"
      )
      .run();
    await out({ material_lines: [] });
    const first = await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: rid(),
        device_lines: [{ device_id: deviceId }]
      },
      "keeper"
    );
    expect((await getTask(h.env, first.created_task_ids[0])).assignee_userid).toBe("inspector");

    h.database.prepare("UPDATE wh_task SET status = 'todo'").run();
    h.database
      .prepare("UPDATE device SET location = 'project', current_project_id = ? WHERE id = ?")
      .run(projectId, deviceId);
    const second = await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: rid(),
        device_lines: [{ device_id: deviceId }]
      },
      "keeper"
    );
    expect(second.created_task_ids).toEqual([]);
  });

  it("返库选错项目：报错说出设备实际在哪", async () => {
    await out({ material_lines: [] });
    await expect(
      createWhDoc(
        h.env,
        {
          doc_type: "back",
          project_id: otherProjectId,
          client_request_id: rid(),
          device_lines: [{ device_id: deviceId }]
        },
        "keeper"
      )
    ).rejects.toMatchObject({ status: 409, message: "SB-0001 不在该项目，现在在：临河 DN1200" });
  });

  it("周转件退回 6、报损 2：在库加 6，在场减 8", async () => {
    await out({ device_lines: [], material_lines: [{ material_id: pipe, quantity: 10 }] });
    await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: rid(),
        material_lines: [
          { material_id: pipe, quantity: 6, outcome: "returned" },
          { material_id: pipe, quantity: 2, outcome: "lost" }
        ]
      },
      "keeper"
    );
    expect((await getMaterial(h.env, pipe)).quantity).toBe(196);
    expect(await holdingOf(projectId, pipe)).toBe(2);
  });

  it("退回加报损超过在场数被拒绝；返库物资行必须选退回或报损", async () => {
    await out({ device_lines: [], material_lines: [{ material_id: pipe, quantity: 10 }] });
    const back = (lines) =>
      createWhDoc(
        h.env,
        {
          doc_type: "back",
          project_id: projectId,
          client_request_id: rid(),
          material_lines: lines
        },
        "keeper"
      );
    await expect(
      back([
        { material_id: pipe, quantity: 8, outcome: "returned" },
        { material_id: pipe, quantity: 3, outcome: "lost" }
      ])
    ).rejects.toMatchObject({ status: 400, message: "排泥钢管 Φ114 在场只有 10" });
    await expect(back([{ material_id: pipe, quantity: 1 }])).rejects.toMatchObject({
      status: 400,
      message: "请选择退回还是报损：排泥钢管 Φ114"
    });
  });

  it("耗材可以退回，不能报损", async () => {
    await out({ device_lines: [], material_lines: [{ material_id: rod, quantity: 10 }] });
    const back = (lines) =>
      createWhDoc(
        h.env,
        {
          doc_type: "back",
          project_id: projectId,
          client_request_id: rid(),
          material_lines: lines
        },
        "keeper"
      );
    await back([{ material_id: rod, quantity: 3, outcome: "returned" }]);
    expect((await getMaterial(h.env, rod)).quantity).toBe(43);
    await expect(back([{ material_id: rod, quantity: 1, outcome: "lost" }])).rejects.toMatchObject({
      status: 400,
      message: "耗材不需要报损：电焊条"
    });
  });

  it("转场：设备换项目，周转件在场数从甲移到乙，在库不变", async () => {
    await out({ material_lines: [{ material_id: pipe, quantity: 10 }] });
    await createWhDoc(
      h.env,
      {
        doc_type: "transfer",
        project_id: projectId,
        to_project_id: otherProjectId,
        client_request_id: rid(),
        device_lines: [{ device_id: deviceId }],
        material_lines: [{ material_id: pipe, quantity: 4 }]
      },
      "keeper"
    );
    const device = await getDevice(h.env, deviceId);
    expect(device).toMatchObject({ current_project_id: otherProjectId });
    expect(device.events[0].summary).toBe("从临河 DN1200转到安定 DN600");
    expect(await holdingOf(projectId, pipe)).toBe(6);
    expect(await holdingOf(otherProjectId, pipe)).toBe(4);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(190);
  });

  it("耗材不能转场；来源和目的相同被拒绝；缺项目被拒绝", async () => {
    await out({ device_lines: [], material_lines: [{ material_id: rod, quantity: 5 }] });
    const transfer = (patch) =>
      createWhDoc(
        h.env,
        {
          doc_type: "transfer",
          project_id: projectId,
          to_project_id: otherProjectId,
          client_request_id: rid(),
          material_lines: [{ material_id: rod, quantity: 1 }],
          ...patch
        },
        "keeper"
      );
    await expect(transfer({})).rejects.toMatchObject({ message: "耗材不能转场：电焊条" });
    await expect(transfer({ to_project_id: projectId })).rejects.toMatchObject({
      message: "来源和目的项目不能相同"
    });
    await expect(out({ project_id: undefined })).rejects.toMatchObject({
      status: 400,
      message: "请选择项目"
    });
  });

  it("在场接口只返回在场数大于 0 的周转件和在该项目的设备", async () => {
    await out({ material_lines: [{ material_id: pipe, quantity: 3 }] });
    await createWhDoc(
      h.env,
      {
        doc_type: "back",
        project_id: projectId,
        client_request_id: rid(),
        material_lines: [{ material_id: pipe, quantity: 3, outcome: "returned" }]
      },
      "keeper"
    );
    h.seed.member("keeper", "keeper");
    const result = await callWh(
      h,
      mountWarehouseRoutes,
      "GET",
      `/warehouse/project/${projectId}/holdings`
    );
    expect(result.status).toBe(200);
    expect(result.body.data.materials).toEqual([]);
    expect(result.body.data.devices.map((d) => d.device_code)).toEqual(["SB-0001"]);
  });
});
