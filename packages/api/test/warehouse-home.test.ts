import { describe, expect, it, vi } from "vitest";

import { mountWarehouseRoutes } from "../src/routes/wh-app";
import { createWhDoc } from "../src/services/warehouse/doc";
import { getWarehouseHome } from "../src/services/warehouse/home";
import { getProjectLedger } from "../src/services/warehouse/project-ledger";
import { getTask } from "../src/services/warehouse/task";
import { authPayload, callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 小程序库房首页的聚合接口，以及任务详情、项目物资为小程序多带的几个字段。

vi.mock("../src/services/auth", () => ({
  verifyToken: async () => ({
    sub: "wang",
    username: "wang",
    nickname: "wang",
    avatar: "",
    roles: ["operator"],
    permissions: [],
    tokenId: "token-wang",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-11-11T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  })
}));

describe.skipIf(!hasSqlite)("库房首页", () => {
  it("普通员工只看到自己的待办，keeper 为 null", async () => {
    const h = createWarehouseHarness();
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-20" });
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-15" });
    h.seed.task({ assignee_userid: "wang", due_date: null });
    h.seed.task({ assignee_userid: "wang", due_date: "2026-11-18" });
    h.seed.task({ assignee_userid: "wang", status: "done" });
    h.seed.task({ assignee_userid: "other" });
    const home = await getWarehouseHome(h.env, authPayload("wang", ["operator"]));
    expect(home.keeper).toBeNull();
    expect(home.caps.is_keeper).toBe(false);
    expect(home.my_tasks.todo).toBe(4);
    expect(home.my_tasks.items.map((task) => task.due_date)).toEqual([
      "2026-11-15",
      "2026-11-18",
      "2026-11-20"
    ]);
    expect(home.my_projects).toEqual([]);
  });

  it("库管带待办数，不带最近的单", async () => {
    const h = createWarehouseHarness();
    h.seed.member("lz", "keeper");
    h.seed.task({ status: "submitted" });
    h.seed.kit({ project_id: h.seed.project(), status: "submitted", confirmed_at: null });
    const home = await getWarehouseHome(h.env, authPayload("lz", ["operator"]));
    expect(home.keeper).toMatchObject({ tasks_to_confirm: 1, kits_to_confirm: 1 });
    expect(home.keeper).not.toHaveProperty("recent_docs");
  });

  it("我的项目带在场数和清单数，归档且无在场的不出现", async () => {
    const h = createWarehouseHarness();
    h.seed.member("lz", "keeper");
    const mine = h.seed.project("一号工程", "zhang");
    const archivedEmpty = h.seed.project("旧工程", "zhang");
    const archivedBusy = h.seed.project("收尾工程", "zhang");
    h.database
      .prepare("UPDATE project SET status = 'archived' WHERE id IN (?, ?)")
      .run(archivedEmpty, archivedBusy);
    h.seed.project("别人的工程", "li");
    const pipe = h.seed.material({ kind: "turnover", quantity: 10 });
    const device = h.seed.device();
    const other = h.seed.device();
    await createWhDoc(
      h.env,
      {
        doc_type: "out",
        client_request_id: "home-out-1",
        project_id: mine,
        device_lines: [{ device_id: device }],
        material_lines: [{ material_id: pipe, quantity: 4 }]
      },
      "lz"
    );
    await createWhDoc(
      h.env,
      {
        doc_type: "out",
        client_request_id: "home-out-2",
        project_id: archivedBusy,
        device_lines: [{ device_id: other }],
        material_lines: []
      },
      "lz"
    );
    h.seed.kit({ project_id: mine, status: "draft", confirmed_at: null });
    h.seed.kit({ project_id: mine });
    const home = await getWarehouseHome(h.env, authPayload("zhang", ["site_manager"]));
    expect(home.my_projects.map((project) => project.project_name)).toEqual([
      "一号工程",
      "收尾工程"
    ]);
    expect(home.my_projects[0]).toMatchObject({
      project_id: mine,
      devices_on_site: 1,
      materials_on_site: 1,
      kits_open: 1,
      kits_confirmed: 1
    });
    expect(home.my_projects[1]).toMatchObject({
      devices_on_site: 1,
      materials_on_site: 0,
      kits_open: 0,
      kits_confirmed: 0
    });
  });

  it("接口返回权限和待办", async () => {
    const h = createWarehouseHarness();
    h.seed.task({ assignee_userid: "wang" });
    const res = await callWh(h, mountWarehouseRoutes, "GET", "/warehouse/home");
    expect(res.status).toBe(200);
    expect(res.body.data.caps).toMatchObject({ is_keeper: false });
    expect(res.body.data.my_tasks.todo).toBe(1);
  });

  it("任务详情带设备位置", async () => {
    const h = createWarehouseHarness();
    const project = h.seed.project("一号工程");
    const device = h.seed.device({
      location: "project",
      current_project_id: project,
      storage_note: "A 区"
    });
    const taskId = h.seed.task({ device_id: device });
    const task = await getTask(h.env, taskId);
    expect(task).toMatchObject({
      device_location: "project",
      device_project_name: "一号工程",
      device_storage_note: "A 区"
    });
  });

  it("没有设备的任务，设备位置三列都是 null", async () => {
    const h = createWarehouseHarness();
    const task = await getTask(h.env, h.seed.task({ device_id: null }));
    expect(task).toMatchObject({
      device_location: null,
      device_project_name: null,
      device_storage_note: null
    });
  });

  it("项目物资带项目负责人", async () => {
    const h = createWarehouseHarness();
    const project = h.seed.project("一号工程", "zhang");
    expect((await getProjectLedger(h.env, project)).project_manager_userid).toBe("zhang");
  });
});
