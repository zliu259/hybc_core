import { describe, expect, it } from "vitest";

import { callWeComProjectTool } from "../src/services/wecom-project-tools";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 企微群里的「项目设备概况」工具改查新库房：在该项目上的设备，以及项目名下的周转件。

describe.skipIf(!hasSqlite)("get_equipment_summary", () => {
  it("返回在该项目上的设备数和清单，不再带设备需求计划", async () => {
    const h = createWarehouseHarness();
    const projectId = h.seed.project("临河 DN1200");
    const other = h.seed.project("安定 DN600");
    const categoryId = h.seed.category("顶管机");
    h.seed.device({
      category_id: categoryId,
      device_code: "SB-0001",
      name: "唐兴 NSPD1200",
      location: "project",
      current_project_id: projectId
    });
    h.seed.device({
      category_id: categoryId,
      device_code: "SB-0002",
      name: "泥浆泵",
      location: "project",
      current_project_id: projectId
    });
    h.seed.device({
      category_id: categoryId,
      device_code: "SB-0003",
      name: "发电机",
      location: "project",
      current_project_id: other
    });
    h.seed.device({ category_id: categoryId, device_code: "SB-0004", name: "油泵站" });

    const result = await callWeComProjectTool(h.env, "get_equipment_summary", {
      project_id: projectId
    });

    expect(result.data).toEqual({
      project_id: projectId,
      active_asset_count: 2,
      devices: [
        { device_code: "SB-0001", name: "唐兴 NSPD1200", category_name: "顶管机" },
        { device_code: "SB-0002", name: "泥浆泵", category_name: "顶管机" }
      ]
    });
  });
});
