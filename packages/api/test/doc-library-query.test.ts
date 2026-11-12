import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isAllowedAgentRead } from "../src/middleware/agent-readonly";
import { docLibraryRoutes } from "../src/routes/doc-library";
import {
  getDocFile,
  getDocTree,
  listDocFiles,
  listDocsForDevice
} from "../src/services/doc-library/query";
import type { Env } from "../src/types/env";
import { callWh, createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 资料的查询：列表、目录树、某台设备适用的资料、详情。

const authState = vi.hoisted(() => ({ sub: "op", roles: ["operator"] }));

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

type Harness = ReturnType<typeof createWarehouseHarness>;

describe.skipIf(!hasSqlite)("资料查询", () => {
  let h: Harness;
  let env: Env;

  beforeEach(() => {
    // UTC 2026-11-11 16:30 = 北京时间 11-12 00:30，"今天" 是 11-12
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T16:30:00.000Z"));
    h = createWarehouseHarness();
    env = h.env as unknown as Env;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const titles = async (query: Record<string, string | undefined> = {}) =>
    (await listDocFiles(env, query)).items.map((row) => row.title);

  it("默认只列最新版，不列已删除的；要历史时连旧版一起列", async () => {
    const old = h.seed.docFile({ title: "说明书 v1", created_at: "2026-11-01T00:00:00.000Z" });
    h.seed.docFile({
      title: "说明书 v2",
      supersedes_id: old,
      created_at: "2026-11-02T00:00:00.000Z"
    });
    h.seed.docFile({ title: "已删除", deleted_at: "2026-11-03T00:00:00.000Z" });
    expect(await titles()).toEqual(["说明书 v2"]);
    expect(await titles({ include_history: "1" })).toEqual(["说明书 v2", "说明书 v1"]);
    const page = await listDocFiles(env, { include_history: "1" });
    expect(page.items.map((row) => row.is_latest)).toEqual([true, false]);
    expect(page.total).toBe(2);
  });

  it("新版被删除后，旧版重新成为最新版", async () => {
    const old = h.seed.docFile({ title: "v1" });
    h.seed.docFile({ title: "v2", supersedes_id: old, deleted_at: "2026-11-03T00:00:00.000Z" });
    const page = await listDocFiles(env, {});
    expect(page.items.map((row) => [row.title, row.is_latest])).toEqual([["v1", true]]);
  });

  it("按设备、类别、通用、资料类别、关键字筛选", async () => {
    const category = h.seed.category("顶管机");
    const device = h.seed.device({
      device_code: "DG-1200-03",
      name: "泥水平衡",
      category_id: category
    });
    h.seed.docFile({ title: "合格证", doc_category: "cert", device_id: device });
    h.seed.docFile({ title: "类别说明书", device_category_id: category });
    h.seed.docFile({ title: "通用安全手册", file_name: "安全.pdf" });
    expect(await titles({ device_id: String(device) })).toEqual(["合格证"]);
    expect(await titles({ device_category_id: String(category) })).toEqual(["类别说明书"]);
    expect(await titles({ scope: "general" })).toEqual(["通用安全手册"]);
    expect(await titles({ doc_category: "cert" })).toEqual(["合格证"]);
    expect(await titles({ keyword: "安全" })).toEqual(["通用安全手册"]);
    // 按设备编号能找到归在那台设备上的资料
    expect(await titles({ keyword: "DG-1200" })).toEqual(["合格证"]);
    const [row] = (await listDocFiles(env, { device_id: String(device) })).items;
    expect(row).toMatchObject({
      scope: "device",
      device_code: "DG-1200-03",
      device_name: "泥水平衡",
      category_name: null
    });
    const [byCategory] = (await listDocFiles(env, { device_category_id: String(category) })).items;
    expect(byCategory).toMatchObject({
      scope: "category",
      category_name: "顶管机",
      device_code: null
    });
    const [general] = (await listDocFiles(env, { scope: "general" })).items;
    expect(general.scope).toBe("general");
  });

  it("有效期：已过期、30 天内到期、还早、没填", async () => {
    h.seed.docFile({
      title: "a",
      valid_until: "2026-11-11",
      created_at: "2026-11-04T00:00:00.000Z"
    });
    h.seed.docFile({
      title: "b",
      valid_until: "2026-12-12",
      created_at: "2026-11-03T00:00:00.000Z"
    });
    h.seed.docFile({
      title: "c",
      valid_until: "2026-12-13",
      created_at: "2026-11-02T00:00:00.000Z"
    });
    h.seed.docFile({ title: "d", valid_until: null, created_at: "2026-11-01T00:00:00.000Z" });
    const page = await listDocFiles(env, {});
    expect(page.items.map((row) => [row.title, row.validity])).toEqual([
      ["a", "expired"],
      ["b", "soon"],
      ["c", "ok"],
      ["d", "none"]
    ]);
    expect(await titles({ validity: "expiring" })).toEqual(["a", "b"]);
  });

  it("筛选参数不对时报中文；分页", async () => {
    await expect(listDocFiles(env, { doc_category: "x" })).rejects.toThrow("资料类别");
    await expect(listDocFiles(env, { device_id: "abc" })).rejects.toThrow("设备");
    for (let index = 0; index < 5; index += 1) {
      h.seed.docFile({ title: `t${index}`, created_at: `2026-11-0${index + 1}T00:00:00.000Z` });
    }
    const page = await listDocFiles(env, { page: "2", pageSize: "2" });
    expect(page.items.map((row) => row.title)).toEqual(["t2", "t1"]);
    expect(page).toMatchObject({ total: 5, page: 2, pageSize: 2 });
  });

  it("目录树：类别自己的、各台设备的、通用的数字都对；旧版和已删除的不算", async () => {
    const machines = h.seed.category("顶管机");
    const pumps = h.seed.category("泥水泵");
    h.seed.category("没资料的类别");
    const a = h.seed.device({ device_code: "DG-01", name: "一号机", category_id: machines });
    const b = h.seed.device({ device_code: "DG-02", name: "二号机", category_id: machines });
    h.seed.device({ device_code: "DG-03", name: "没资料", category_id: machines });
    const pump = h.seed.device({ device_code: "NSB-01", name: "泵", category_id: pumps });
    const old = h.seed.docFile({ device_id: a });
    h.seed.docFile({ device_id: a, supersedes_id: old });
    h.seed.docFile({ device_id: a });
    h.seed.docFile({ device_id: b });
    h.seed.docFile({ device_id: b, deleted_at: "2026-11-03T00:00:00.000Z" });
    h.seed.docFile({ device_id: pump });
    h.seed.docFile({ device_category_id: machines });
    h.seed.docFile({});
    h.seed.docFile({});
    expect(await getDocTree(env)).toEqual({
      total: 7,
      general: 2,
      categories: [
        {
          category_id: machines,
          category_name: "顶管机",
          own: 1,
          devices: [
            { device_id: a, device_code: "DG-01", name: "一号机", count: 2 },
            { device_id: b, device_code: "DG-02", name: "二号机", count: 1 }
          ]
        },
        {
          category_id: pumps,
          category_name: "泥水泵",
          own: 0,
          devices: [{ device_id: pump, device_code: "NSB-01", name: "泵", count: 1 }]
        }
      ]
    });
  });

  it("设备适用的资料：这台的、这类的、通用的，越具体越靠前", async () => {
    const machines = h.seed.category("顶管机");
    const others = h.seed.category("泥水泵");
    const device = h.seed.device({ category_id: machines });
    const other = h.seed.device({ category_id: machines });
    h.seed.docFile({ title: "通用-说明书", doc_category: "manual" });
    h.seed.docFile({ title: "类别-说明书", doc_category: "manual", device_category_id: machines });
    h.seed.docFile({ title: "本机-合格证", doc_category: "cert", device_id: device });
    h.seed.docFile({ title: "本机-保养", doc_category: "maintenance", device_id: device });
    h.seed.docFile({ title: "本机-说明书", doc_category: "manual", device_id: device });
    h.seed.docFile({ title: "别的设备", device_id: other });
    h.seed.docFile({ title: "别的类别", device_category_id: others });
    const plain = await listDocsForDevice(env, device);
    expect(plain.map((row) => [row.title, row.scope])).toEqual([
      ["本机-说明书", "device"],
      ["本机-合格证", "device"],
      ["本机-保养", "device"],
      ["类别-说明书", "category"],
      ["通用-说明书", "general"]
    ]);
    // 检查、维修、保养任务：保养维修排最前，然后是说明书
    const forRepair = await listDocsForDevice(env, device, "maintenance");
    expect(forRepair.map((row) => row.title).slice(0, 3)).toEqual([
      "本机-保养",
      "本机-说明书",
      "本机-合格证"
    ]);
    await expect(listDocsForDevice(env, 99999)).rejects.toThrow("设备不存在");
  });

  it("详情带历史版本，新的在前；已删除的查不到", async () => {
    const v1 = h.seed.docFile({ title: "v1" });
    const v2 = h.seed.docFile({ title: "v2", supersedes_id: v1 });
    const v3 = h.seed.docFile({ title: "v3", supersedes_id: v2 });
    const detail = await getDocFile(env, v3);
    expect(detail?.title).toBe("v3");
    expect(detail?.is_latest).toBe(true);
    expect(detail?.history.map((row) => row.title)).toEqual(["v2", "v1"]);
    expect((await getDocFile(env, v1))?.is_latest).toBe(false);
    const gone = h.seed.docFile({ deleted_at: "2026-11-03T00:00:00.000Z" });
    expect(await getDocFile(env, gone)).toBeNull();
    expect(await getDocFile(env, 99999)).toBeNull();
  });

  describe("接口", () => {
    const mount = (app: Parameters<Parameters<typeof callWh>[1]>[0]) =>
      app.route("/api/v1/doc-library", docLibraryRoutes);
    const call = (path: string) => callWh(h, mount, "GET", `/doc-library${path}`);

    it("配置：分片大小、上限、资料类别的中文、能收的扩展名", async () => {
      const res = await call("/config");
      expect(res.status).toBe(200);
      expect(res.body.data.part_size).toBe(8 * 1024 * 1024);
      expect(res.body.data.max_bytes).toBe(2048 * 1024 * 1024);
      expect(res.body.data.max_bytes_miniapp).toBe(200 * 1024 * 1024);
      expect(res.body.data.categories).toEqual([
        { key: "cert", label: "合格证" },
        { key: "report", label: "检测报告" },
        { key: "params", label: "技术参数" },
        { key: "manual", label: "说明书" },
        { key: "maintenance", label: "保养维修" },
        { key: "other", label: "其他" }
      ]);
      expect(res.body.data.extensions).toContain("pdf");
      expect(res.body.data.extensions).not.toContain("html");
    });

    it("操作员能看列表、目录树、详情、设备适用资料", async () => {
      const device = h.seed.device();
      const id = h.seed.docFile({ title: "合格证", device_id: device });
      const list = await call("/file");
      expect(list.status).toBe(200);
      expect(list.body.data.map((row: { title: string }) => row.title)).toEqual(["合格证"]);
      expect(list.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect((await call("/tree")).body.data.total).toBe(1);
      expect((await call(`/file/${id}`)).body.data.title).toBe("合格证");
      expect((await call(`/for-device/${device}?task_kind=inspection`)).body.data).toHaveLength(1);
    });

    it("不存在的资料和设备返回 404，筛选参数不对返回 400", async () => {
      expect((await call("/file/99999")).status).toBe(404);
      expect((await call("/for-device/99999")).status).toBe(404);
      const bad = await call("/file?doc_category=x");
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toContain("资料类别");
    });
  });

  it("智能体令牌的只读白名单里没有资料接口", () => {
    expect(isAllowedAgentRead("GET", "/api/v1/doc-library/file")).toBe(false);
    expect(isAllowedAgentRead("GET", "/api/v1/doc-library/file/1/url")).toBe(false);
    expect(isAllowedAgentRead("GET", "/api/v1/doc-library/tree")).toBe(false);
  });
});
