import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { getWarehouseCapabilities } from "../src/services/warehouse/access";
import {
  confirmProjectKit,
  createProjectKit,
  discardProjectKit,
  submitProjectKit,
  updateProjectKit
} from "../src/services/warehouse/kit";
import { getProjectKit, listProjectKits } from "../src/services/warehouse/kit-query";
import { authPayload, callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

const authState = vi.hoisted(() => ({
  sub: "keeper",
  roles: ["operator"],
  authMethod: "wecom_oauth"
}));

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
    auth_method: authState.authMethod,
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("项目配套清单", () => {
  let h;
  let projectId;
  let otherProjectId;
  let welding;
  let pipe114;
  let pipe80;
  let templateId;

  const as = async (sub, roles) => {
    const auth = authPayload(sub, roles);
    return [auth, await getWarehouseCapabilities(h.env, auth)];
  };

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200", "lead");
    otherProjectId = h.seed.project("安定 DN600", "someone-else");
    h.seed.member("keeper", "keeper");
    welding = h.seed.material({ name: "电焊条", spec: "J422", kind: "consumable" });
    pipe114 = h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米" });
    pipe80 = h.seed.material({ name: "排泥钢管", spec: "Φ80", unit: "米" });
    templateId = h.seed.kitTemplate({ name: "泥水平衡" }, [
      { line_kind: "material", name_text: "电焊条", default_qty: 5 },
      { line_kind: "material", name_text: "排泥钢管", default_qty: 120 },
      { line_kind: "material", name_text: "排泥钢管", spec_text: "Φ80", default_qty: 60 }
    ]);
    authState.sub = "keeper";
    authState.roles = ["operator"];
    authState.authMethod = "wecom_oauth";
  });

  const fromTemplate = async (auth, caps, patch = {}) =>
    createProjectKit(
      h.env,
      { project_id: projectId, title: "临河 DN1200", template_id: templateId, ...patch },
      auth,
      caps
    );

  it("从模板生成：唯一的同名物资自动选上；同名两种规格且模板没写规格时留空", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const { id, kit_no } = await fromTemplate(auth, caps);
    expect(kit_no).toMatch(/^PT-\d{8}-0001$/);
    const kit = await getProjectKit(h.env, id);
    expect(kit).toMatchObject({
      status: "draft",
      project_name: "临河 DN1200",
      project_manager_userid: "lead",
      template_name: "泥水平衡",
      line_count: 3
    });
    expect(
      kit.lines.map((l) => [
        l.name_text,
        l.material_spec ?? null,
        l.planned_qty,
        l.spec_choices.length
      ])
    ).toEqual([
      ["电焊条", "J422", 5, 1],
      ["排泥钢管", null, 120, 2],
      ["排泥钢管", "Φ80", 60, 2]
    ]);
    expect(kit.lines[1].spec_choices.map((c) => c.spec)).toEqual(["Φ114", "Φ80"]);
  });

  it("还没选规格的物资行不能提交，报出第几行；选好后库管提交直接确认", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const { id } = await fromTemplate(auth, caps);
    await expect(submitProjectKit(h.env, id, { version: 0 }, auth, caps)).rejects.toMatchObject({
      status: 400,
      message: "第 2 行：排泥钢管 还没选规格"
    });
    const kit = await getProjectKit(h.env, id);
    const lines = kit.lines.map((l, index) => (index === 1 ? { ...l, material_id: pipe114 } : l));
    await updateProjectKit(h.env, id, { version: 0, lines }, auth, caps);
    expect(await submitProjectKit(h.env, id, { version: 1 }, auth, caps)).toEqual({
      status: "confirmed"
    });
    expect(await getProjectKit(h.env, id)).toMatchObject({
      status: "confirmed",
      submitted_by_userid: "keeper",
      confirmed_by_userid: "keeper",
      version: 2
    });
  });

  it("现场负责人：给自己的项目建清单并提交，状态待确认；给别人的项目建 403；库管确认", async () => {
    const [lead, leadCaps] = await as("lead", ["site_manager"]);
    const { id } = await createProjectKit(
      h.env,
      {
        project_id: projectId,
        title: "临河 追加",
        lines: [
          {
            section: "辅助设备",
            line_kind: "material",
            material_id: pipe80,
            name_text: "排泥钢管",
            planned_qty: 50
          }
        ]
      },
      lead,
      leadCaps
    );
    expect(await submitProjectKit(h.env, id, { version: 0 }, lead, leadCaps)).toEqual({
      status: "submitted"
    });
    await expect(
      createProjectKit(h.env, { project_id: otherProjectId, title: "x" }, lead, leadCaps)
    ).rejects.toMatchObject({ status: 403, message: "只能给自己负责的项目建清单" });
    await expect(confirmProjectKit(h.env, id, { version: 1 }, "lead")).resolves.toBeUndefined();
    expect(await getProjectKit(h.env, id)).toMatchObject({
      status: "confirmed",
      confirmed_by_userid: "lead"
    });
  });

  it("计划数为 0 的物资行不需要选规格", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const { id } = await fromTemplate(auth, caps);
    const kit = await getProjectKit(h.env, id);
    const lines = kit.lines.map((l, index) => (index === 1 ? { ...l, planned_qty: 0 } : l));
    await updateProjectKit(h.env, id, { version: 0, lines }, auth, caps);
    expect(await submitProjectKit(h.env, id, { version: 1 }, auth, caps)).toEqual({
      status: "confirmed"
    });
  });

  it("从另一份清单复制：行、规格、来源、计划数都照抄；停用的物资变成待选规格", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const source = h.seed.kit({ project_id: otherProjectId }, [
      { material_id: pipe114, name_text: "排泥钢管", planned_qty: 80, source: "warehouse" },
      { material_id: welding, name_text: "电焊条", planned_qty: 3, source: "site_purchase" },
      { line_kind: "text", name_text: "集装箱", planned_qty: 0, source: "rental", note: "本地租" }
    ]);
    h.database.prepare("UPDATE material SET status = 'disabled' WHERE id = ?").run(welding);
    const { id } = await createProjectKit(
      h.env,
      { project_id: projectId, title: "照安定的清单", copy_from_kit_id: source },
      auth,
      caps
    );
    const kit = await getProjectKit(h.env, id);
    expect(kit.copied_from_kit_id).toBe(source);
    expect(
      kit.lines.map((l) => [l.name_text, l.material_id, l.planned_qty, l.source, l.note])
    ).toEqual([
      ["排泥钢管", pipe114, 80, "warehouse", null],
      ["电焊条", null, 3, "site_purchase", null],
      ["集装箱", null, 0, "rental", "本地租"]
    ]);
  });

  it("模板和复制只能选一个；模板停用不能用", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    await expect(
      fromTemplate(auth, caps, { copy_from_kit_id: h.seed.kit({ project_id: projectId }) })
    ).rejects.toMatchObject({ status: 400, message: "模板和复制只能选一个" });
    h.database.prepare("UPDATE kit_template SET status = 'disabled' WHERE id = ?").run(templateId);
    await expect(fromTemplate(auth, caps)).rejects.toMatchObject({
      status: 400,
      message: "模板已停用"
    });
  });

  it("已确认的清单不能再改，也不能作废（409）；作废必须写原因", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const confirmed = h.seed.kit({ project_id: projectId });
    await expect(
      updateProjectKit(h.env, confirmed, { version: 0, title: "改" }, auth, caps)
    ).rejects.toMatchObject({ status: 409, message: "清单已确认，不能再改；要追加请新建一份清单" });
    await expect(
      discardProjectKit(h.env, confirmed, { version: 0, reason: "不要了" }, auth, caps)
    ).rejects.toMatchObject({ status: 409, message: "已确认的清单不能作废，结清后可以关闭" });
    const { id } = await fromTemplate(auth, caps);
    await expect(
      discardProjectKit(h.env, id, { version: 0, reason: " " }, auth, caps)
    ).rejects.toMatchObject({ status: 400, message: "作废原因不能为空" });
    await discardProjectKit(h.env, id, { version: 0, reason: "建错项目了" }, auth, caps);
    expect(await getProjectKit(h.env, id)).toMatchObject({
      status: "closed",
      close_reason: "建错项目了",
      closed_by_userid: "keeper"
    });
  });

  it("版本号不对 409；没有版本号 400", async () => {
    const [auth, caps] = await as("keeper", ["operator"]);
    const { id } = await fromTemplate(auth, caps);
    await updateProjectKit(h.env, id, { version: 0, title: "改一次" }, auth, caps);
    await expect(
      updateProjectKit(h.env, id, { version: 0, title: "又改" }, auth, caps)
    ).rejects.toMatchObject({ status: 409, message: "数据已变化，请刷新后重试" });
    await expect(updateProjectKit(h.env, id, { title: "x" }, auth, caps)).rejects.toMatchObject({
      status: 400
    });
  });

  it("接口：操作员建清单 403；经理 201；经理确认 403；智能体令牌 403；列表按项目和状态筛选", async () => {
    const call = (method, path, body) => callWh(h, mountWarehouseRoutes, method, path, body);
    const body = { project_id: projectId, title: "临河", template_id: templateId };
    authState.sub = "worker";
    expect((await call("POST", "/warehouse/kit", body)).status).toBe(403);
    authState.sub = "boss";
    authState.roles = ["manager"];
    authState.authMethod = "mcp_agent";
    expect((await call("POST", "/warehouse/kit", body)).status).toBe(403);
    authState.authMethod = "wecom_oauth";
    const created = await call("POST", "/warehouse/kit", body);
    expect(created).toMatchObject({ status: 201, body: { data: { kit_no: expect.any(String) } } });
    const id = created.body.data.id;
    const kit = (await call("GET", `/warehouse/kit/${id}`)).body.data;
    const lines = kit.lines.map((l, index) => (index === 1 ? { ...l, material_id: pipe114 } : l));
    expect((await call("PUT", `/warehouse/kit/${id}`, { version: 0, lines })).status).toBe(200);
    expect(
      (await call("POST", `/warehouse/kit/${id}/submit`, { version: 1 })).body.data.status
    ).toBe("submitted");
    expect((await call("POST", `/warehouse/kit/${id}/confirm`, { version: 2 })).status).toBe(403);
    authState.sub = "keeper";
    authState.roles = ["operator"];
    expect((await call("POST", `/warehouse/kit/${id}/confirm`, { version: 2 })).status).toBe(200);
    h.seed.kit({ project_id: otherProjectId, status: "draft" });
    const list = await call("GET", `/warehouse/kit?project_id=${projectId}&status=confirmed`);
    expect(list.body).toMatchObject({ pagination: { total: 1 } });
    expect(list.body.data[0]).toMatchObject({ id, project_name: "临河 DN1200" });
    expect((await listProjectKits(h.env, {})).total).toBe(2);
    expect((await call("GET", "/warehouse/kit/999")).status).toBe(404);
  });
});
