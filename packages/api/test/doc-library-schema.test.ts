import { beforeEach, describe, expect, it } from "vitest";

import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 迁移 0097：资料库两张表的约束写在数据库里，代码绕不过去。

const NOW = "2026-11-12T00:00:00.000Z";

describe.skipIf(!hasSqlite)("资料库表结构", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  const insertDoc = (patch = {}) => {
    const row = {
      title: "合格证",
      file_name: "合格证.pdf",
      file_key: `doc-library/2026/${Math.random().toString(16).slice(2)}-a.pdf`,
      file_size: 10,
      content_type: "application/pdf",
      doc_category: "cert",
      uploaded_by_userid: "lz",
      created_at: NOW,
      updated_at: NOW,
      ...patch
    };
    const columns = Object.keys(row);
    return h.database
      .prepare(
        `INSERT INTO doc_file (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => row[column]));
  };

  it("两张表和索引都在", () => {
    const names = h.database
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'doc_%' OR name LIKE 'idx_doc_%'")
      .all()
      .map((row) => row.name);
    for (const name of [
      "doc_file",
      "doc_share",
      "idx_doc_file_device_id",
      "idx_doc_file_device_category_id",
      "idx_doc_file_supersedes_id",
      "idx_doc_file_valid_until",
      "idx_doc_share_doc_file_id"
    ]) {
      expect(names).toContain(name);
    }
  });

  it("归属只能填设备或类别其中一个", () => {
    const device = h.seed.device();
    const category = h.seed.category();
    expect(() => insertDoc({ device_id: device })).not.toThrow();
    expect(() => insertDoc({ device_category_id: category })).not.toThrow();
    expect(() => insertDoc()).not.toThrow();
    expect(() => insertDoc({ device_id: device, device_category_id: category })).toThrow(/CHECK/);
  });

  it("资料类别只有六种，文件大小必须大于 0，文件键不能重复", () => {
    expect(() => insertDoc({ doc_category: "x" })).toThrow(/CHECK/);
    expect(() => insertDoc({ file_size: 0 })).toThrow(/CHECK/);
    insertDoc({ file_key: "doc-library/2026/same.pdf" });
    expect(() => insertDoc({ file_key: "doc-library/2026/same.pdf" })).toThrow(/UNIQUE/);
  });

  it("对外链接的令牌不能重复，访问次数默认 0", () => {
    const docId = Number(insertDoc().lastInsertRowid);
    const insertShare = (token) =>
      h.database
        .prepare(
          "INSERT INTO doc_share (token, doc_file_id, expires_at, created_by_userid, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(token, docId, NOW, "lz", NOW);
    insertShare("t1");
    expect(() => insertShare("t1")).toThrow(/UNIQUE/);
    expect(
      h.database.prepare("SELECT access_count FROM doc_share WHERE token = 't1'").get().access_count
    ).toBe(0);
  });

  it("夹具：seed.docFile 建一行资料，同时把文件放进假的存储里", () => {
    const id = h.seed.docFile({ title: "说明书" });
    const row = h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
    expect(row.title).toBe("说明书");
    expect(row.doc_category).toBe("manual");
    expect(row.device_id).toBeNull();
    expect(h.env.FILES.objects.has(row.file_key)).toBe(true);
    expect(h.env.FILES.objects.get(row.file_key).body.length).toBe(row.file_size);
  });
});
