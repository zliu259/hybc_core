import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { getDevice } from "../src/services/warehouse/device";
import { createWhDoc } from "../src/services/warehouse/doc";
import { getWhDoc } from "../src/services/warehouse/doc-query";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { scrapDevice, unscrapDevice } from "../src/services/warehouse/doc-scrap";
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
const rid = () => `req-rev-${String((seq += 1)).padStart(4, "0")}`;

describe.skipIf(!hasSqlite)("报废和冲销", () => {
  let h;
  let projectId;
  let otherProjectId;
  let deviceId;
  let pipe;
  let clamp;

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200");
    otherProjectId = h.seed.project("安定 DN600");
    deviceId = h.seed.device({ device_code: "SB-0001", name: "唐兴 NSPD1200" });
    pipe = h.seed.material({ name: "排泥钢管", spec: "Φ114", quantity: 0 });
    clamp = h.seed.material({ name: "卡扣", spec: "DN114", quantity: 0 });
    authState.sub = "keeper";
    authState.roles = ["operator"];
  });

  const doc = (input) => createWhDoc(h.env, { client_request_id: rid(), ...input }, "keeper");
  const reverse = (id) => reverseWhDoc(h.env, id, { client_request_id: rid() }, "keeper");
  const holdingOf = async (pid, materialId) =>
    (await getProjectHoldings(h.env, pid)).materials.find((m) => m.material_id === materialId)
      ?.holding ?? 0;

  it("报废必须写原因并带照片；报废后状态是已报废；撤销后回到在库", async () => {
    await expect(
      scrapDevice(
        h.env,
        deviceId,
        { client_request_id: rid(), photo_keys: ["wh-doc/a.jpg"] },
        "boss"
      )
    ).rejects.toMatchObject({
      message: "报废原因不能为空"
    });
    await expect(
      scrapDevice(h.env, deviceId, { client_request_id: rid(), remark: "主轴断裂" }, "boss")
    ).rejects.toMatchObject({
      message: "请上传报废照片"
    });
    const result = await scrapDevice(
      h.env,
      deviceId,
      { client_request_id: rid(), remark: "主轴断裂", photo_keys: ["wh-doc/a.jpg"] },
      "boss"
    );
    expect((await getWhDoc(h.env, result.id)).doc_type).toBe("scrap");
    const device = await getDevice(h.env, deviceId);
    expect(device).toMatchObject({ state: "scrapped", location: "scrapped" });
    expect(device.events[0]).toMatchObject({ event_type: "scrapped", summary: "报废：主轴断裂" });
    await expect(
      scrapDevice(
        h.env,
        deviceId,
        { client_request_id: rid(), remark: "x", photo_keys: ["wh-doc/a.jpg"] },
        "boss"
      )
    ).rejects.toMatchObject({
      status: 409
    });

    await unscrapDevice(h.env, deviceId, { client_request_id: rid() }, "admin");
    expect(await getDevice(h.env, deviceId)).toMatchObject({
      state: "available",
      location: "warehouse"
    });
    await expect(
      unscrapDevice(h.env, deviceId, { client_request_id: rid() }, "admin")
    ).rejects.toMatchObject({ status: 409 });
  });

  it("在项目上的设备可以直接报废，项目被清空", async () => {
    await doc({ doc_type: "out", project_id: projectId, device_lines: [{ device_id: deviceId }] });
    await scrapDevice(
      h.env,
      deviceId,
      { client_request_id: rid(), remark: "现场损毁", photo_keys: ["wh-doc/a.jpg"] },
      "boss"
    );
    expect(await getDevice(h.env, deviceId)).toMatchObject({
      location: "scrapped",
      current_project_id: null
    });
  });

  it("库管不能报废，经理可以；经理不能撤销报废，超管可以", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    h.seed.member("keeper", "keeper");
    const body = () => ({ client_request_id: rid(), remark: "坏了", photo_keys: ["wh-doc/a.jpg"] });
    expect((await call("POST", `/warehouse/device/${deviceId}/scrap`, body())).status).toBe(403);
    authState.sub = "boss";
    authState.roles = ["manager"];
    expect((await call("POST", `/warehouse/device/${deviceId}/scrap`, body())).status).toBe(201);
    expect(
      (await call("POST", `/warehouse/device/${deviceId}/unscrap`, { client_request_id: rid() }))
        .status
    ).toBe(403);
    authState.roles = ["super_admin"];
    expect(
      (await call("POST", `/warehouse/device/${deviceId}/unscrap`, { client_request_id: rid() }))
        .status
    ).toBe(201);
  });

  it("冲销入库：数量回到原值，原单显示已被哪张单冲销", async () => {
    const original = await doc({
      doc_type: "inbound",
      material_lines: [{ material_id: pipe, quantity: 10 }]
    });
    const reversal = await reverse(original.id);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(0);
    expect((await getWhDoc(h.env, original.id)).reversed_by_doc_no).toBe(reversal.doc_no);
    const lines = (await getWhDoc(h.env, reversal.id)).lines;
    expect(lines.map((l) => [l.quantity, l.stock_delta, l.balance_after])).toEqual([[10, -10, 0]]);
    expect((await getWhDoc(h.env, reversal.id)).reverses_doc_id).toBe(original.id);
  });

  it("入库的东西已经发出去一部分：冲销被拒绝并指出是哪项", async () => {
    const original = await doc({
      doc_type: "inbound",
      material_lines: [
        { material_id: pipe, quantity: 10 },
        { material_id: clamp, quantity: 10 }
      ]
    });
    await doc({
      doc_type: "out",
      project_id: projectId,
      material_lines: [{ material_id: clamp, quantity: 4 }]
    });
    await expect(reverse(original.id)).rejects.toMatchObject({
      status: 400,
      message: "库存不足，无法冲销：卡扣 DN114"
    });
    expect((await getMaterial(h.env, pipe)).quantity).toBe(10);
  });

  it("冲销发货：设备回库，周转件在场数归零，在库数恢复", async () => {
    await doc({ doc_type: "inbound", material_lines: [{ material_id: pipe, quantity: 10 }] });
    const original = await doc({
      doc_type: "out",
      project_id: projectId,
      device_lines: [{ device_id: deviceId }],
      material_lines: [{ material_id: pipe, quantity: 6 }]
    });
    await reverse(original.id);
    expect(await getDevice(h.env, deviceId)).toMatchObject({
      location: "warehouse",
      current_project_id: null
    });
    expect((await getDevice(h.env, deviceId)).events[0].summary).toBe(
      `单据 ${(await getWhDoc(h.env, original.id)).doc_no} 已冲销`
    );
    expect(await holdingOf(projectId, pipe)).toBe(0);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(10);
  });

  it("发出去的周转件已经退回了：冲销发货被拒绝", async () => {
    await doc({ doc_type: "inbound", material_lines: [{ material_id: pipe, quantity: 10 }] });
    const original = await doc({
      doc_type: "out",
      project_id: projectId,
      material_lines: [{ material_id: pipe, quantity: 6 }]
    });
    await doc({
      doc_type: "back",
      project_id: projectId,
      material_lines: [{ material_id: pipe, quantity: 6, outcome: "returned" }]
    });
    await expect(reverse(original.id)).rejects.toMatchObject({
      status: 400,
      message: "排泥钢管 Φ114 在场只有 0，无法冲销"
    });
  });

  it("设备发货后又转了场：冲销发货被拒绝", async () => {
    const original = await doc({
      doc_type: "out",
      project_id: projectId,
      device_lines: [{ device_id: deviceId }]
    });
    await doc({
      doc_type: "transfer",
      project_id: projectId,
      to_project_id: otherProjectId,
      device_lines: [{ device_id: deviceId }]
    });
    await expect(reverse(original.id)).rejects.toMatchObject({
      status: 409,
      message: "SB-0001 之后又有新的单据，不能冲销"
    });
  });

  it("冲销返库：设备回到项目，检查任务被取消，使用记录不再计入", async () => {
    await doc({ doc_type: "out", project_id: projectId, device_lines: [{ device_id: deviceId }] });
    const back = await doc({
      doc_type: "back",
      project_id: projectId,
      device_lines: [{ device_id: deviceId, usage_meters: 100 }]
    });
    await reverse(back.id);
    expect(await getTask(h.env, back.created_task_ids[0])).toMatchObject({
      status: "cancelled",
      cancel_reason: "单据冲销"
    });
    expect(await getDevice(h.env, deviceId)).toMatchObject({
      location: "project",
      current_project_id: projectId,
      usage_records: [],
      usage_meters_total: 0
    });
  });

  it("检查任务已经有照片：冲销返库被拒绝", async () => {
    await doc({ doc_type: "out", project_id: projectId, device_lines: [{ device_id: deviceId }] });
    const back = await doc({
      doc_type: "back",
      project_id: projectId,
      device_lines: [{ device_id: deviceId }]
    });
    h.database
      .prepare(
        "INSERT INTO wh_task_photo (task_id, file_key, uploaded_by_userid, created_at) VALUES (?, 'wh-task/a.jpg', 'keeper', 'now')"
      )
      .run(back.created_task_ids[0]);
    await expect(reverse(back.id)).rejects.toMatchObject({
      status: 409,
      message: "返库后的检查任务已经开始，不能冲销"
    });
  });

  it("同一张单冲销两次：第二次 409；冲销单不能再冲销；报废单不能冲销", async () => {
    const original = await doc({
      doc_type: "inbound",
      material_lines: [{ material_id: pipe, quantity: 1 }]
    });
    const reversal = await reverse(original.id);
    await expect(reverse(original.id)).rejects.toMatchObject({
      status: 409,
      message: "这张单已经冲销过"
    });
    await expect(reverse(reversal.id)).rejects.toMatchObject({
      status: 400,
      message: "冲销单不能再冲销"
    });
    const scrap = await scrapDevice(
      h.env,
      deviceId,
      { client_request_id: rid(), remark: "坏", photo_keys: ["wh-doc/a.jpg"] },
      "boss"
    );
    await expect(reverse(scrap.id)).rejects.toMatchObject({
      status: 400,
      message: "这种单据不能冲销"
    });
  });

  it("冲销用同一个 client_request_id 重放返回同一张单", async () => {
    const original = await doc({
      doc_type: "inbound",
      material_lines: [{ material_id: pipe, quantity: 1 }]
    });
    const first = await reverseWhDoc(
      h.env,
      original.id,
      { client_request_id: "rev-same-0001" },
      "keeper"
    );
    const second = await reverseWhDoc(
      h.env,
      original.id,
      { client_request_id: "rev-same-0001" },
      "keeper"
    );
    expect(second).toMatchObject({ id: first.id, replayed: true });
  });

  it("接口：库管可以冲销", async () => {
    h.seed.member("keeper", "keeper");
    const original = await doc({
      doc_type: "inbound",
      material_lines: [{ material_id: pipe, quantity: 1 }]
    });
    const result = await callWh(
      h,
      mountWarehouseRoutes,
      "POST",
      `/warehouse/doc/${original.id}/reverse`,
      { client_request_id: rid() }
    );
    expect(result.status).toBe(201);
    expect(
      (
        await callWh(h, mountWarehouseRoutes, "POST", "/warehouse/doc/999/reverse", {
          client_request_id: rid()
        })
      ).status
    ).toBe(404);
  });
});
