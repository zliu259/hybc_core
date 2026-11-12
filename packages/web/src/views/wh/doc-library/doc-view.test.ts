import { describe, expect, it } from "vitest";

import type { DocFileRow } from "@/api/wh/doc-library-types";
import type { WarehouseCapabilities } from "@/api/wh/types";
import {
  docActions,
  formatFileSize,
  ownerText,
  previewKind,
  treeSelection,
  validityTag
} from "./doc-view";

const doc = (patch: Partial<DocFileRow> = {}): DocFileRow => ({
  id: 1,
  title: "合格证",
  file_name: "合格证.pdf",
  file_key: "doc-library/2026/x-合格证.pdf",
  file_size: 1024,
  content_type: "application/pdf",
  doc_category: "cert",
  device_id: null,
  device_category_id: null,
  valid_until: null,
  supersedes_id: null,
  uploaded_by_userid: "liu",
  deleted_at: null,
  deleted_by_userid: null,
  version: 0,
  created_at: "2026-11-12T00:00:00.000Z",
  updated_at: "2026-11-12T00:00:00.000Z",
  device_code: null,
  device_name: null,
  category_name: null,
  scope: "general",
  is_latest: true,
  validity: "none",
  ...patch
});

const caps = (isDocAdmin: boolean): WarehouseCapabilities => ({
  is_keeper: false,
  is_doc_admin: isDocAdmin,
  can_scrap: false,
  can_unscrap: false,
  can_manage_settings: false,
  can_create_kit: false
});

describe("previewKind", () => {
  it("PDF、图片、视频能在页面里看，其余下载", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/jpeg")).toBe("image");
    expect(previewKind("image/png")).toBe("image");
    expect(previewKind("video/mp4")).toBe("video");
    expect(previewKind("application/zip")).toBe("download");
    expect(
      previewKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("download");
    expect(previewKind("")).toBe("download");
  });

  it("浏览器显示不了的图片（HEIC）和可能带脚本的 SVG 走下载", () => {
    expect(previewKind("image/heic")).toBe("download");
    expect(previewKind("image/svg+xml")).toBe("download");
  });
});

describe("formatFileSize", () => {
  it("按大小换单位，最多一位小数", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(980)).toBe("980 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
    expect(formatFileSize(5 * 1024 * 1024 * 1024 * 1024)).toBe("5120 GB");
  });

  it("四舍五入后到 1024 的进到下一个单位", () => {
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1 MB");
  });

  it("不是正常数字时显示横线", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});

describe("validityTag", () => {
  it("已过期标红、30 天内到期标橙，其余不标", () => {
    expect(validityTag("expired")).toEqual({ text: "已过期", type: "danger" });
    expect(validityTag("soon")).toEqual({
      text: "30 天内到期",
      type: "warning"
    });
    expect(validityTag("ok")).toBeNull();
    expect(validityTag("none")).toBeNull();
  });
});

describe("ownerText", () => {
  it("设备的写编号和名称，类别的写类别，其余是通用", () => {
    expect(
      ownerText(
        doc({
          scope: "device",
          device_id: 3,
          device_code: "SB-0003",
          device_name: "唐兴"
        })
      )
    ).toBe("SB-0003 唐兴");
    expect(
      ownerText(
        doc({
          scope: "category",
          device_category_id: 2,
          category_name: "顶管机"
        })
      )
    ).toBe("类别：顶管机");
    expect(ownerText(doc())).toBe("通用");
  });

  it("设备或类别的名字取不到时不出现 null", () => {
    expect(ownerText(doc({ scope: "device", device_id: 3 }))).toBe("设备");
    expect(ownerText(doc({ scope: "category", device_category_id: 2 }))).toBe(
      "类别"
    );
  });
});

describe("docActions", () => {
  const all = {
    canEdit: true,
    canDelete: true,
    canReplace: true,
    canShare: true
  };
  const none = {
    canEdit: false,
    canDelete: false,
    canReplace: false,
    canShare: false
  };

  it("资料管理员对最新版能改、删、替换、生成对外链接", () => {
    expect(docActions(doc(), caps(true))).toEqual(all);
  });
  it("普通员工只能看", () => {
    expect(docActions(doc(), caps(false))).toEqual(none);
  });
  it("被替换的旧版本谁都只能看", () => {
    expect(docActions(doc({ is_latest: false }), caps(true))).toEqual(none);
  });
  it("权限还没取到时只能看", () => {
    expect(docActions(doc(), null)).toEqual(none);
  });
});

describe("treeSelection", () => {
  it("点目录树的一项得到列表的筛选条件", () => {
    expect(treeSelection({ kind: "all" })).toEqual({});
    expect(treeSelection({ kind: "general" })).toEqual({ scope: "general" });
    expect(treeSelection({ kind: "category", categoryId: 2 })).toEqual({
      device_category_id: "2"
    });
    expect(treeSelection({ kind: "device", deviceId: 7 })).toEqual({
      device_id: "7"
    });
  });
});
