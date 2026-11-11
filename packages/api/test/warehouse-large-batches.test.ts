import { beforeEach, describe, expect, it } from "vitest";

import { createWhDoc } from "../src/services/warehouse/doc";
import { getProjectHoldings } from "../src/services/warehouse/holdings";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { importDevices, importMaterials } from "../src/services/warehouse/import";
import { listDevices } from "../src/services/warehouse/device";
import { getMaterial, listMaterials } from "../src/services/warehouse/material";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// D1 一条语句最多绑定 100 个参数；导入和单据最多 200 行，所以按 120、150 行测
describe.skipIf(!hasSqlite)("超过 100 行的导入和单据（D1 参数上限）", () => {
  let h;
  let projectId;
  let otherProjectId;
  let seq = 0;
  const rid = () => `req-large-${String((seq += 1)).padStart(4, "0")}`;
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  beforeEach(() => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200");
    otherProjectId = h.seed.project("安定 DN600");
  });

  it("导入 150 条品名各不相同的物资（带期初）", async () => {
    const rows = range(150).map((i) => ({
      name: `物资${i}`,
      spec: "S",
      unit: "个",
      category: "工具",
      kind: "turnover",
      opening_quantity: 2
    }));
    const result = await importMaterials(h.env, { client_request_id: rid(), rows }, "keeper");
    expect(result).toMatchObject({ created: 150, errors: [] });
    expect((await listMaterials(h.env, { pageSize: "500" })).total).toBe(150);
  });

  it("导入 150 台带编号的设备，分在两个项目上", async () => {
    const rows = range(150).map((i) => ({
      device_code: `DN-${i}`,
      name: `顶管机${i}`,
      category_name: "顶管机",
      project_name: i % 2 ? "临河 DN1200" : ""
    }));
    const result = await importDevices(h.env, { client_request_id: rid(), rows }, "keeper");
    expect(result).toMatchObject({ created: 150, errors: [] });
    expect((await listDevices(h.env, { pageSize: "200" })).total).toBe(150);
  });

  it("一张入库单 150 行，再整单冲销", async () => {
    const ids = range(150).map((i) => h.seed.material({ name: `管${i}`, quantity: 1 }));
    const inbound = await createWhDoc(
      h.env,
      {
        doc_type: "inbound",
        client_request_id: rid(),
        material_lines: ids.map((id) => ({ material_id: id, quantity: 3 }))
      },
      "keeper"
    );
    expect((await getMaterial(h.env, ids[149])).quantity).toBe(4);
    await reverseWhDoc(h.env, inbound.id, { client_request_id: rid() }, "keeper");
    expect((await getMaterial(h.env, ids[149])).quantity).toBe(1);
  });

  it("120 种周转件发往项目、转场、再全部返库", async () => {
    const ids = range(120).map((i) => h.seed.material({ name: `配件${i}`, quantity: 10 }));
    const lines = ids.map((id) => ({ material_id: id, quantity: 5 }));
    await createWhDoc(
      h.env,
      { doc_type: "out", client_request_id: rid(), project_id: projectId, material_lines: lines },
      "keeper"
    );
    await createWhDoc(
      h.env,
      {
        doc_type: "transfer",
        client_request_id: rid(),
        project_id: projectId,
        to_project_id: otherProjectId,
        material_lines: lines
      },
      "keeper"
    );
    expect((await getProjectHoldings(h.env, otherProjectId)).materials).toHaveLength(120);
    await createWhDoc(
      h.env,
      {
        doc_type: "back",
        client_request_id: rid(),
        project_id: otherProjectId,
        material_lines: ids.map((id) => ({ material_id: id, quantity: 5, outcome: "returned" }))
      },
      "keeper"
    );
    expect((await getProjectHoldings(h.env, otherProjectId)).materials).toHaveLength(0);
    expect((await getMaterial(h.env, ids[0])).quantity).toBe(10);
  });

  it("101 台设备一起发往项目再返库，每台生成检查任务", async () => {
    const category = h.seed.category("顶管机");
    const ids = range(101).map((i) =>
      h.seed.device({ device_code: `SB-${String(i + 1).padStart(4, "0")}`, category_id: category })
    );
    const devices = ids.map((id) => ({ device_id: id }));
    await createWhDoc(
      h.env,
      { doc_type: "out", client_request_id: rid(), project_id: projectId, device_lines: devices },
      "keeper"
    );
    const back = await createWhDoc(
      h.env,
      { doc_type: "back", client_request_id: rid(), project_id: projectId, device_lines: devices },
      "keeper"
    );
    expect(back.created_task_ids).toHaveLength(101);
  });
});
