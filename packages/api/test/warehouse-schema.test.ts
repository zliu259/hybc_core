import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 迁移 0095 的表结构约束：这些规则写在数据库里，代码绕不过去。

const NOW = "2026-11-11T00:00:00.000Z";

describe.skipIf(!hasSqlite)("库房核心表结构", () => {
  let h;
  let categoryId;
  let projectId;

  beforeEach(() => {
    h = createWarehouseHarness();
    categoryId = h.seed.category("顶管机");
    projectId = h.seed.project("临河 DN1200");
  });

  const insertDevice = (patch) =>
    h.database
      .prepare(
        `INSERT INTO device (device_code, name, category_id, location, current_project_id, created_by_userid, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'seed', ?, ?)`
      )
      .run(
        `D-${Math.random()}`,
        "机头",
        categoryId,
        patch.location,
        patch.current_project_id,
        NOW,
        NOW
      );

  const insertDoc = (clientRequestId = `req-${Math.random()}`) =>
    Number(
      h.database
        .prepare(
          `INSERT INTO wh_doc (doc_no, doc_type, operator_userid, occurred_at, client_request_id, created_at)
           VALUES (?, 'inbound', 'keeper', ?, ?, ?)`
        )
        .run(`KFD-${Math.random()}`, NOW, clientRequestId, NOW).lastInsertRowid
    );

  const insertLine = (patch) =>
    h.database
      .prepare(
        `INSERT INTO wh_doc_line (doc_id, device_id, material_id, quantity, created_at) VALUES (?, ?, ?, 1, ?)`
      )
      .run(insertDoc(), patch.device_id, patch.material_id, NOW);

  it("设备在项目时必须有项目，在库时不能有", () => {
    expect(() => insertDevice({ location: "project", current_project_id: null })).toThrow(
      "device_project_matches_location"
    );
    expect(() => insertDevice({ location: "warehouse", current_project_id: projectId })).toThrow(
      "device_project_matches_location"
    );
    expect(() =>
      insertDevice({ location: "project", current_project_id: projectId })
    ).not.toThrow();
  });

  it("物资数量不能为负", () => {
    const id = h.seed.material({ quantity: 1 });
    expect(() =>
      h.database.prepare("UPDATE material SET quantity = quantity - 2 WHERE id = ?").run(id)
    ).toThrow("material_quantity_non_negative");
  });

  it("同品名同规格不能重复", () => {
    h.seed.material({ name: "排泥钢管", spec: "Φ114" });
    expect(() => h.seed.material({ name: "排泥钢管", spec: "Φ114" })).toThrow("UNIQUE");
    expect(() => h.seed.material({ name: "排泥钢管", spec: "Φ80" })).not.toThrow();
  });

  it("单据行必须恰好指向设备或物资之一", () => {
    const deviceId = h.seed.device({ category_id: categoryId });
    const materialId = h.seed.material();
    expect(() => insertLine({ device_id: deviceId, material_id: materialId })).toThrow(
      "wh_doc_line_one_target"
    );
    expect(() => insertLine({ device_id: null, material_id: null })).toThrow(
      "wh_doc_line_one_target"
    );
    expect(() => insertLine({ device_id: deviceId, material_id: null })).not.toThrow();
  });

  it("同一个 client_request_id 只能有一张单", () => {
    insertDoc("req-same-0001");
    expect(() => insertDoc("req-same-0001")).toThrow("UNIQUE");
  });

  it("库管名单的角色只能是库管或资料管理员", () => {
    h.seed.member("lizhen", "keeper");
    expect(() => h.seed.member("lizhen", "admin")).toThrow("CHECK");
    expect(() => h.seed.member("lizhen", "keeper")).toThrow("UNIQUE");
  });

  it("wh_guard 迁移后是空表", () => {
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
  });
});
