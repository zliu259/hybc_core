import { describe, expect, it } from "vitest";

import { loadOurEntityContext } from "./our-entities";

/** 极简 D1 桩：按 SQL 特征分派 all/first 结果 */
const fakeDb = (options: {
  activeRows?: Array<{ id: number; entity_name: string }>;
  byIdRow?: { entity_name: string } | null;
  throwOnQuery?: boolean;
}) =>
  ({
    prepare() {
      if (options.throwOnQuery) throw new Error("d1 down");
      return {
        bind() {
          return {
            async first() {
              return options.byIdRow ?? null;
            }
          };
        },
        async all() {
          return { results: options.activeRows ?? [] };
        }
      };
    }
  }) as unknown as D1Database;

describe("loadOurEntityContext", () => {
  it("返回本单主体名与集团实体名单（顿号分隔）", async () => {
    const db = fakeDb({
      activeRows: [
        { id: 1, entity_name: "恒越百川建设集团有限公司" },
        { id: 11, entity_name: "北京鑫丰畅建设有限公司" }
      ]
    });
    const ctx = await loadOurEntityContext(db, 11);
    expect(ctx.our_entity).toBe("北京鑫丰畅建设有限公司");
    expect(ctx.our_entities).toBe("恒越百川建设集团有限公司、北京鑫丰畅建设有限公司");
  });

  it("本单主体已停用时单独兜底查询", async () => {
    const db = fakeDb({
      activeRows: [{ id: 1, entity_name: "恒越百川建设集团有限公司" }],
      byIdRow: { entity_name: "已停用实体有限公司" }
    });
    const ctx = await loadOurEntityContext(db, 99);
    expect(ctx.our_entity).toBe("已停用实体有限公司");
    expect(ctx.our_entities).toBe("恒越百川建设集团有限公司");
  });

  it("实体表为空时给出兜底名单文案", async () => {
    const ctx = await loadOurEntityContext(fakeDb({ activeRows: [] }), 1);
    expect(ctx.our_entity).toBe("");
    expect(ctx.our_entities).toContain("实体表为空");
  });

  it("DB 异常不抛出，返回兜底（实体缺失不得阻断任务派发）", async () => {
    const ctx = await loadOurEntityContext(fakeDb({ throwOnQuery: true }), 1);
    expect(ctx.our_entity).toBe("");
    expect(ctx.our_entities).toContain("恒越百川");
  });
});
