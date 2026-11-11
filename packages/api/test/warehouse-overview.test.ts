import { afterEach, describe, expect, it, vi } from "vitest";

import { createWhDoc } from "../src/services/warehouse/doc";
import { getWarehouseOverview } from "../src/services/warehouse/overview";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

describe.skipIf(!hasSqlite)("库房总览", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("各个数字和最近单据", async () => {
    // UTC 2026-11-11 16:30 = 北京时间 11-12 00:30，"今天" 是 11-12。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T16:30:00.000Z"));
    const h = createWarehouseHarness();
    const projectId = h.seed.project("临河 DN1200");
    const a = h.seed.device();
    const b = h.seed.device();
    h.seed.device({ location: "project", current_project_id: projectId });
    h.seed.device({ location: "scrapped" });
    h.seed.task({
      device_id: a,
      kind: "inspection",
      status: "submitted",
      assignee_userid: "w",
      due_date: "2026-11-12"
    });
    h.seed.task({
      device_id: b,
      kind: "maintenance",
      status: "todo",
      assignee_userid: null,
      due_date: "2026-11-11"
    });
    h.seed.task({ kind: "other", status: "done", due_date: "2026-11-01" });
    h.seed.material({ quantity: 1, min_stock: 5 });
    h.seed.material({ quantity: 10, min_stock: 5 });
    const m = h.seed.material({ quantity: 0 });
    for (let i = 0; i < 12; i += 1) {
      await createWhDoc(
        h.env,
        {
          doc_type: "inbound",
          client_request_id: `req-ov-${String(i).padStart(4, "0")}`,
          material_lines: [{ material_id: m, quantity: 1 }]
        },
        "keeper"
      );
    }

    const overview = await getWarehouseOverview(h.env);
    expect(overview).toMatchObject({
      tasks_to_confirm: 1,
      tasks_unassigned: 1,
      tasks_overdue: 1,
      devices_pending_inspection: 1,
      devices_repairing: 1,
      devices_on_project: 1,
      low_stock_count: 1
    });
    expect(overview.recent_docs).toHaveLength(10);
  });
});
