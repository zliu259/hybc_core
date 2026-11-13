import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 迁移 0099：资料的镜像字段和微盘目录缓存。

describe.skipIf(!hasSqlite)("0099 镜像字段", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  it("doc_file 有 8 个镜像字段，老资料默认是 pending、0 次", () => {
    const id = h.seed.docFile({ title: "合格证" });
    const row = h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
    expect(row).toMatchObject({
      mirror_status: "pending",
      mirror_error: null,
      mirror_attempts: 0,
      mirror_started_at: null,
      mirrored_at: null,
      wedrive_fileid: null,
      wedrive_name: null,
      wedrive_folder_key: null
    });
  });

  it("mirror_status 只认五种值", () => {
    const id = h.seed.docFile({});
    const set = (status) =>
      h.database.prepare("UPDATE doc_file SET mirror_status = ? WHERE id = ?").run(status, id);
    for (const status of ["pending", "syncing", "synced", "failed", "skipped"]) set(status);
    expect(() => set("done")).toThrow(/CHECK/);
  });

  it("有按镜像状态查的索引", () => {
    const names = h.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name);
    expect(names).toContain("idx_doc_file_mirror_status");
  });

  it("wedrive_folder 的 folder_key 不能重复", () => {
    const insert = (key) =>
      h.database
        .prepare(
          `INSERT INTO wedrive_folder (folder_key, fileid, name, parent_key, created_at, updated_at)
           VALUES (?, 'f1', '通用', NULL, '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`
        )
        .run(key);
    insert("general");
    insert("category:9");
    expect(() => insert("general")).toThrow(/UNIQUE|PRIMARY/);
  });
});
