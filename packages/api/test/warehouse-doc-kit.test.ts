import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWhDoc } from "../src/services/warehouse/doc";
import { getWhDoc, listWhDocs } from "../src/services/warehouse/doc-query";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { isGuardFailure } from "../src/services/warehouse/guard";
import { getMaterial } from "../src/services/warehouse/material";
import { getKitFulfilment } from "../src/services/warehouse/project-ledger";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

vi.mock("../src/services/auth", () => ({ verifyToken: async () => null }));

describe.skipIf(!hasSqlite)("发货单关联配套清单", () => {
  let h;
  let p;
  let q;
  let pipe;
  let kit;
  let seq = 0;

  beforeEach(() => {
    h = createWarehouseHarness();
    p = h.seed.project("临河 DN1200");
    q = h.seed.project("安定 DN600");
    pipe = h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米", quantity: 200 });
    kit = h.seed.kit({ project_id: p, kit_no: "PT-20261111-0001" }, [
      { material_id: pipe, name_text: "排泥钢管", planned_qty: 100 }
    ]);
  });

  const rid = () => `req-dockit-${String((seq += 1)).padStart(4, "0")}`;
  const out = (patch = {}) =>
    createWhDoc(
      h.env,
      {
        doc_type: "out",
        client_request_id: rid(),
        project_id: p,
        project_kit_id: kit,
        material_lines: [{ material_id: pipe, quantity: 40 }],
        ...patch
      },
      "keeper"
    );
  const docCount = () => h.database.prepare("SELECT COUNT(*) AS n FROM wh_doc").get().n;

  it("带清单发货：单头记下清单，执行情况里已发增加", async () => {
    const result = await out();
    expect(await getWhDoc(h.env, result.id)).toMatchObject({
      project_kit_id: kit,
      kit_no: "PT-20261111-0001"
    });
    expect((await getKitFulfilment(h.env, kit))[0]).toMatchObject({ shipped: 40, pending: 60 });
  });

  it.each([
    ["不存在的清单", () => ({ project_kit_id: 999 }), 400, "配套清单不存在"],
    [
      "别的项目的清单",
      (hh) => ({ project_kit_id: hh.seed.kit({ project_id: q }) }),
      400,
      "配套清单不属于这个项目"
    ],
    [
      "草稿清单",
      (hh) => ({
        project_kit_id: hh.seed.kit({ project_id: p, status: "draft", confirmed_at: null })
      }),
      409,
      "配套清单还没确认"
    ],
    [
      "待确认的清单",
      (hh) => ({
        project_kit_id: hh.seed.kit({ project_id: p, status: "submitted", confirmed_at: null })
      }),
      409,
      "配套清单还没确认"
    ],
    [
      "已关闭的清单",
      (hh) => ({ project_kit_id: hh.seed.kit({ project_id: p, status: "closed" }) }),
      409,
      "配套清单已关闭"
    ],
    [
      "返库单带清单",
      () => ({
        doc_type: "back",
        material_lines: [{ material_id: pipe, quantity: 1, outcome: "returned" }]
      }),
      400,
      "只有发往项目的单能关联配套清单"
    ]
  ])("%s：拒绝，不生成单、数量不变", async (_label, patch, status, message) => {
    await expect(out(patch(h))).rejects.toMatchObject({ status, message });
    expect(docCount()).toBe(0);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(200);
  });

  it("提交途中清单被关闭（批内断言）：整单回滚", async () => {
    const realBatch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements) => {
      h.database.prepare("UPDATE project_kit SET status = 'closed' WHERE id = ?").run(kit);
      return realBatch(statements);
    };
    await expect(out()).rejects.toSatisfy(isGuardFailure);
    expect(docCount()).toBe(0);
    expect((await getMaterial(h.env, pipe)).quantity).toBe(200);
  });

  it("冲销按清单发的货：冲销单也带清单号，执行情况里已发恢复", async () => {
    const shipped = await out();
    const reversal = await reverseWhDoc(h.env, shipped.id, { client_request_id: rid() }, "keeper");
    expect(await getWhDoc(h.env, reversal.id)).toMatchObject({ project_kit_id: kit });
    expect((await getKitFulfilment(h.env, kit))[0]).toMatchObject({ shipped: 0, pending: 100 });
  });

  it("单据列表带清单号；不带清单的单为空", async () => {
    await out();
    await out({ project_kit_id: undefined });
    const docs = await listWhDocs(h.env, { doc_type: "out" });
    expect(docs.items.map((d) => d.kit_no ?? "无")).toEqual(
      expect.arrayContaining(["无", "PT-20261111-0001"])
    );
    expect(docs.total).toBe(2);
  });
});
