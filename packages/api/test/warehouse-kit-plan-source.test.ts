import { beforeEach, describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { loadPlanSource } from "../src/services/warehouse/kit-plan-source";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
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

const NOW = "2026-11-13T00:00:00.000Z";

describe.skipIf(!hasSqlite)("按项目参数生成：从工作段和项目档案取参数", () => {
  let h;
  let projectId;

  const setProject = (id, patch) => {
    const columns = Object.keys(patch);
    h.database
      .prepare(
        `UPDATE project SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`
      )
      .run(...columns.map((column) => patch[column]), id);
  };
  let sectionSeq = 0;
  const addSection = (id, patch = {}) => {
    sectionSeq += 1;
    const row = {
      project_id: id,
      section_code: `S${sectionSeq}`,
      section_name: `${sectionSeq}#`,
      created_at: NOW,
      updated_at: NOW,
      ...patch
    };
    const columns = Object.keys(row);
    h.database
      .prepare(
        `INSERT INTO project_section (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column]));
  };
  const as = (sub, roles) => {
    authState.sub = sub;
    authState.roles = roles;
  };
  const call = (path) => callWh(h, mountWarehouseRoutes, "GET", path);

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("阳坊");
    h.seed.member("keeper", "keeper");
    as("keeper", ["operator"]);
  });

  it("有工作段时从工作段取：段数、总长、最长一段、管径、土质、机型", async () => {
    setProject(projectId, { machine_type: "土压平衡", pipe_spec: "D2000", geotech_soil: "细砂" });
    addSection(projectId, {
      section_length: 80,
      pipe_diameter_mm: 1600,
      soil_type: "粉质粘土",
      assigned_machine_type: "泥水平衡"
    });
    addSection(projectId, {
      section_length: 105,
      pipe_diameter_mm: 1600,
      soil_type: "粉质粘土",
      assigned_machine_type: "泥水平衡"
    });
    addSection(projectId, {
      section_length: 60.5,
      pipe_diameter_mm: 1600,
      soil_type: "粘土",
      assigned_machine_type: "泥水平衡"
    });
    const fromSection = { from: "section" };
    expect(await loadPlanSource(h.env, projectId)).toEqual({
      params: {
        section_count: 3,
        total_length_m: 245.5,
        longest_drive_m: 105,
        pipe_diameter_mm: 1600,
        soil: "粉质粘土、粘土",
        machine_type: "泥水平衡"
      },
      sources: {
        section_count: fromSection,
        total_length_m: fromSection,
        longest_drive_m: fromSection,
        pipe_diameter_mm: fromSection,
        soil: fromSection,
        machine_type: fromSection
      },
      has_text: false
    });
  });

  it("有的工作段没填长度：不给总长度和最长一段（给了就是少算的数），段数照给", async () => {
    addSection(projectId, { section_length: 80 });
    addSection(projectId, { section_length: 105 });
    addSection(projectId, {});
    const source = await loadPlanSource(h.env, projectId);
    expect(source.params).toEqual({ section_count: 3 });
    expect(source.sources).toEqual({ section_count: { from: "section" } });
  });

  it("工作段的管径不一致时不取这一项，改从项目档案取；机型只有一种非空的就取", async () => {
    setProject(projectId, { machine_type: "土压平衡", pipe_spec: "D1600" });
    addSection(projectId, { pipe_diameter_mm: 1600 });
    addSection(projectId, { pipe_diameter_mm: 1200, jacking_method: "泥水平衡" });
    const source = await loadPlanSource(h.env, projectId);
    expect(source.params).toEqual({
      section_count: 2,
      pipe_diameter_mm: 1600,
      machine_type: "泥水平衡"
    });
    expect(source.sources).toEqual({
      section_count: { from: "section" },
      pipe_diameter_mm: { from: "project" },
      machine_type: { from: "section" }
    });
  });

  it("工作段的机型有两种时不取，改从项目档案取；先看指定机型，都空再看顶进方式", async () => {
    setProject(projectId, { machine_type: "泥水平衡" });
    addSection(projectId, { assigned_machine_type: "泥水平衡" });
    addSection(projectId, { assigned_machine_type: "土压平衡" });
    const source = await loadPlanSource(h.env, projectId);
    expect(source.params.machine_type).toBe("泥水平衡");
    expect(source.sources.machine_type).toEqual({ from: "project" });

    const other = h.seed.project("另一个");
    addSection(other, { assigned_machine_type: "土压平衡", jacking_method: "泥水平衡" });
    expect((await loadPlanSource(h.env, other)).params.machine_type).toBe("土压平衡");
  });

  it.each([
    ["DN800", 800],
    ["D1550*2", 1550],
    ["  d2000 ", 2000],
    ["钢管", undefined],
    ["D99999", undefined],
    ["D200", undefined],
    [null, undefined]
  ])("没有工作段时从项目档案取：pipe_spec %s → %s", async (spec, diameter) => {
    setProject(projectId, {
      pipe_spec: spec,
      machine_type: " 泥水平衡 ",
      geotech_soil: "粘土,粉土"
    });
    const source = await loadPlanSource(h.env, projectId);
    expect(source.params.pipe_diameter_mm).toBe(diameter);
    expect(source.params.machine_type).toBe("泥水平衡");
    expect(source.params.soil).toBe("粘土、粉土");
    expect(source.params.section_count).toBeUndefined();
    expect(source.params.total_length_m).toBeUndefined();
    expect(source.sources.soil).toEqual({ from: "project" });
  });

  it("什么都没有时参数是空的；简报或历史备注有字时 has_text 是 true", async () => {
    expect(await loadPlanSource(h.env, projectId)).toEqual({
      params: {},
      sources: {},
      has_text: false
    });
    setProject(projectId, { project_briefing: "   " });
    expect((await loadPlanSource(h.env, projectId)).has_text).toBe(false);
    setProject(projectId, { project_briefing: "管径D1600 mm，顶进方式泥水平衡" });
    expect((await loadPlanSource(h.env, projectId)).has_text).toBe(true);
    setProject(projectId, { project_briefing: null, legacy_note: "W1-W23共计22段,1600m。" });
    expect((await loadPlanSource(h.env, projectId)).has_text).toBe(true);
  });

  it("工作段里不合理的数不取：长度 0 或负数、管径超出范围、段数超过 200", async () => {
    addSection(projectId, { section_length: 0, pipe_diameter_mm: 99999 });
    addSection(projectId, { section_length: -5, pipe_diameter_mm: 99999 });
    expect((await loadPlanSource(h.env, projectId)).params).toEqual({ section_count: 2 });
    const many = h.seed.project("很多段");
    for (let i = 0; i < 201; i += 1) addSection(many, {});
    expect((await loadPlanSource(h.env, many)).params).toEqual({});
  });

  it("项目不存在 404", async () => {
    await expect(loadPlanSource(h.env, 999)).rejects.toMatchObject({
      status: 404,
      message: "项目不存在"
    });
  });

  it("接口：库管能取任何项目；现场负责人只能取自己负责的项目；没有建清单权限的 403", async () => {
    setProject(projectId, { pipe_spec: "D1600" });
    const mine = h.seed.project("我的", "lead");
    setProject(mine, { pipe_spec: "D800" });

    const keeper = await call(`/warehouse/kit/plan/source?project_id=${projectId}`);
    expect(keeper.status).toBe(200);
    expect(keeper.body.data.params).toEqual({ pipe_diameter_mm: 1600 });

    as("lead", ["site_manager"]);
    expect((await call(`/warehouse/kit/plan/source?project_id=${mine}`)).body.data.params).toEqual({
      pipe_diameter_mm: 800
    });
    expect(await call(`/warehouse/kit/plan/source?project_id=${projectId}`)).toEqual({
      status: 403,
      body: { success: false, error: { message: "只能给自己负责的项目建清单" } }
    });

    as("op", ["operator"]);
    expect((await call(`/warehouse/kit/plan/source?project_id=${projectId}`)).status).toBe(403);
    as("fin", ["finance"]);
    expect((await call(`/warehouse/kit/plan/source?project_id=${projectId}`)).status).toBe(403);
  });

  it("接口：project_id 不是正整数 400；项目不存在 404", async () => {
    expect((await call("/warehouse/kit/plan/source?project_id=abc")).status).toBe(400);
    expect((await call("/warehouse/kit/plan/source")).status).toBe(400);
    expect((await call("/warehouse/kit/plan/source?project_id=999")).status).toBe(404);
  });
});
