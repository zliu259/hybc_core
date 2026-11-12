import { describe, expect, it, vi } from "vitest";

import type { DocLibraryConfig } from "@/api/wh/doc-library-types";
import {
  groupFolderImport,
  guessDocCategory,
  isJunkFile,
  splitParts,
  titleFromFileName,
  uploadFileInParts,
  uploadProblem,
  type UploadDeps
} from "./doc-upload";

const MB = 1024 * 1024;

describe("splitParts", () => {
  it("按固定大小切片，最后一片是剩下的", () => {
    expect(splitParts(20 * MB, 8 * MB)).toEqual([
      { partNumber: 1, start: 0, end: 8 * MB },
      { partNumber: 2, start: 8 * MB, end: 16 * MB },
      { partNumber: 3, start: 16 * MB, end: 20 * MB }
    ]);
  });
  it("小文件只有一片", () => {
    expect(splitParts(1024, 8 * MB)).toEqual([
      { partNumber: 1, start: 0, end: 1024 }
    ]);
  });
  it("正好整除不多出空片", () => {
    expect(splitParts(16 * MB, 8 * MB)).toHaveLength(2);
  });
  it("大小或片大小不对时不切", () => {
    expect(splitParts(0, 8 * MB)).toEqual([]);
    expect(splitParts(10, 0)).toEqual([]);
  });
});

describe("uploadFileInParts", () => {
  const file = new Blob([new Uint8Array(20)]);
  const makeDeps = (putPart: UploadDeps["putPart"]): UploadDeps => ({
    init: vi.fn(async () => ({
      upload_token: "tok",
      part_size: 8,
      part_count: 3
    })),
    putPart,
    abort: vi.fn(async () => undefined),
    retryDelayMs: 0
  });

  it("三片都成功：按顺序传，进度是已传字节数，返回完成请求要的东西", async () => {
    const sizes: number[] = [];
    const putPart = vi.fn(
      async (_token: string, partNumber: number, blob: Blob) => {
        sizes.push(blob.size);
        return { part_number: partNumber, etag: `e${partNumber}` };
      }
    );
    const deps = makeDeps(putPart);
    const progress: number[] = [];
    const result = await uploadFileInParts(file, "合格证.pdf", deps, sent =>
      progress.push(sent)
    );

    expect(deps.init).toHaveBeenCalledWith({
      file_name: "合格证.pdf",
      file_size: 20
    });
    expect(putPart.mock.calls.map(call => [call[0], call[1]])).toEqual([
      ["tok", 1],
      ["tok", 2],
      ["tok", 3]
    ]);
    expect(sizes).toEqual([8, 8, 4]);
    expect(progress).toEqual([8, 16, 20]);
    expect(result).toEqual({
      upload_token: "tok",
      parts: [
        { part_number: 1, etag: "e1" },
        { part_number: 2, etag: "e2" },
        { part_number: 3, etag: "e3" }
      ]
    });
    expect(deps.abort).not.toHaveBeenCalled();
  });

  it("第 2 片前两次失败第三次成功：整体成功，一共传了 5 次", async () => {
    let failures = 2;
    const putPart = vi.fn(async (_token: string, partNumber: number) => {
      if (partNumber === 2 && failures > 0) {
        failures -= 1;
        throw new Error("网络断了");
      }
      return { part_number: partNumber, etag: `e${partNumber}` };
    });
    const deps = makeDeps(putPart);
    const result = await uploadFileInParts(
      file,
      "a.pdf",
      deps,
      () => undefined
    );
    expect(result.parts).toHaveLength(3);
    expect(putPart).toHaveBeenCalledTimes(5);
    expect(deps.abort).not.toHaveBeenCalled();
  });

  it("第 2 片三次都失败：报「第 2 片上传失败」，放弃这次上传，不传第 3 片", async () => {
    const putPart = vi.fn(async (_token: string, partNumber: number) => {
      if (partNumber === 2) throw new Error("网络断了");
      return { part_number: partNumber, etag: `e${partNumber}` };
    });
    const deps = makeDeps(putPart);
    const progress: number[] = [];
    await expect(
      uploadFileInParts(file, "a.pdf", deps, sent => progress.push(sent))
    ).rejects.toThrow("第 2 片上传失败");
    expect(putPart.mock.calls.map(call => call[1])).toEqual([1, 2, 2, 2]);
    expect(deps.abort).toHaveBeenCalledWith("tok");
    expect(progress).toEqual([8]);
  });

  it("放弃上传的请求自己也失败时，报的还是哪一片没传上", async () => {
    const deps: UploadDeps = {
      ...makeDeps(async () => {
        throw new Error("网络断了");
      }),
      abort: vi.fn(async () => {
        throw new Error("放弃也失败");
      }),
      retries: 1
    };
    await expect(
      uploadFileInParts(file, "a.pdf", deps, () => undefined)
    ).rejects.toThrow("第 1 片上传失败");
  });

  it("初始化被拒绝时原样报出原因，不传任何一片", async () => {
    const putPart = vi.fn();
    const deps: UploadDeps = {
      init: vi.fn(async () => {
        throw new Error("不支持这种文件：exe");
      }),
      putPart,
      abort: vi.fn(async () => undefined)
    };
    await expect(
      uploadFileInParts(file, "a.exe", deps, () => undefined)
    ).rejects.toThrow("不支持这种文件：exe");
    expect(putPart).not.toHaveBeenCalled();
    expect(deps.abort).not.toHaveBeenCalled();
  });

  it("中途取消：不再传后面的片，放弃这次上传，报「已取消」", async () => {
    const controller = new AbortController();
    const putPart = vi.fn(async (_token: string, partNumber: number) => {
      if (partNumber === 1) controller.abort();
      return { part_number: partNumber, etag: `e${partNumber}` };
    });
    const deps: UploadDeps = {
      ...makeDeps(putPart),
      signal: controller.signal
    };
    await expect(
      uploadFileInParts(file, "a.pdf", deps, () => undefined)
    ).rejects.toThrow("已取消");
    expect(putPart).toHaveBeenCalledTimes(1);
    expect(deps.abort).toHaveBeenCalledWith("tok");
  });

  it("取消时正在传的那一片失败了，不重试", async () => {
    const controller = new AbortController();
    const putPart = vi.fn(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    const deps: UploadDeps = {
      ...makeDeps(putPart),
      signal: controller.signal
    };
    await expect(
      uploadFileInParts(file, "a.pdf", deps, () => undefined)
    ).rejects.toThrow("已取消");
    expect(putPart).toHaveBeenCalledTimes(1);
  });
});

describe("guessDocCategory", () => {
  it("按文件名里的关键字猜资料类别", () => {
    expect(guessDocCategory("1200顶管机合格证.pdf")).toBe("cert");
    expect(guessDocCategory("第三方检测报告2026.pdf")).toBe("report");
    expect(guessDocCategory("压力表检定证书.jpg")).toBe("report");
    expect(guessDocCategory("技术参数表.xlsx")).toBe("params");
    expect(guessDocCategory("使用说明书.pdf")).toBe("manual");
    expect(guessDocCategory("操作手册.docx")).toBe("manual");
    expect(guessDocCategory("维修记录.xlsx")).toBe("maintenance");
    expect(guessDocCategory("保养使用记录.xlsx")).toBe("maintenance");
    expect(guessDocCategory("IMG_0032.jpg")).toBe("other");
  });
});

describe("titleFromFileName", () => {
  it("去掉扩展名", () => {
    expect(titleFromFileName("合格证.pdf")).toBe("合格证");
    expect(titleFromFileName("v1.2 说明书.final.PDF")).toBe(
      "v1.2 说明书.final"
    );
    expect(titleFromFileName("没有扩展名")).toBe("没有扩展名");
    expect(titleFromFileName(".gitignore")).toBe(".gitignore");
  });
  it("太长的截到 120 个字", () => {
    expect(titleFromFileName(`${"长".repeat(200)}.pdf`)).toHaveLength(120);
  });
});

describe("groupFolderImport", () => {
  const devices = [
    {
      id: 1,
      device_code: "DG-1200-03",
      name: "1200 泥水平衡顶管机",
      alias: "老三号"
    },
    {
      id: 2,
      device_code: "DG-1200-031",
      name: "1200 土压平衡顶管机",
      alias: null
    },
    { id: 3, device_code: "SB-0009", name: "泥浆泵", alias: null },
    { id: 4, device_code: "SB-0010", name: "泥浆泵", alias: null }
  ];
  const entry = (path: string) => ({
    path,
    file: new File(["x"], path.split("/").pop() ?? "")
  });
  const summary = (paths: string[]) =>
    groupFolderImport(paths.map(entry), devices).map(group => ({
      folder: group.folder,
      deviceId: group.deviceId,
      matchedBy: group.matchedBy,
      files: group.files.map(item => `${item.title}:${item.category}`)
    }));

  it("选了总文件夹：按一级子文件夹分组，编号、名称、现场叫法能对上设备", () => {
    expect(
      summary([
        "顶管机资料/DG-1200-03 泥水平衡/合格证.pdf",
        "顶管机资料/DG-1200-03 泥水平衡/说明书.pdf",
        "顶管机资料/老三号/说明书.pdf",
        "顶管机资料/1200 土压平衡顶管机/参数表.xlsx",
        "顶管机资料/不认识的/x.pdf"
      ])
    ).toEqual([
      {
        folder: "DG-1200-03 泥水平衡",
        deviceId: 1,
        matchedBy: "code",
        files: ["合格证:cert", "说明书:manual"]
      },
      {
        folder: "老三号",
        deviceId: 1,
        matchedBy: "name",
        files: ["说明书:manual"]
      },
      {
        folder: "1200 土压平衡顶管机",
        deviceId: 2,
        matchedBy: "name",
        files: ["参数表:params"]
      },
      {
        folder: "不认识的",
        deviceId: null,
        matchedBy: null,
        files: ["x:other"]
      }
    ]);
  });

  it("根目录下的散文件单独一组，系统文件和临时文件不要", () => {
    expect(
      summary([
        "顶管机资料/总说明.pdf",
        "顶管机资料/.DS_Store",
        "顶管机资料/老三号/Thumbs.db",
        "顶管机资料/老三号/~$说明书.docx",
        "顶管机资料/老三号/desktop.ini",
        "顶管机资料/老三号/合格证.pdf"
      ])
    ).toEqual([
      { folder: "", deviceId: null, matchedBy: null, files: ["总说明:other"] },
      {
        folder: "老三号",
        deviceId: 1,
        matchedBy: "name",
        files: ["合格证:cert"]
      }
    ]);
  });

  it("只选了一台设备的文件夹（只有一层）：整个文件夹一组", () => {
    expect(summary(["合格证/a.pdf", "合格证/b.pdf"])).toEqual([
      {
        folder: "合格证",
        deviceId: null,
        matchedBy: null,
        files: ["a:cert", "b:cert"]
      }
    ]);
    expect(summary(["老三号/合格证.pdf"])).toEqual([
      {
        folder: "老三号",
        deviceId: 1,
        matchedBy: "name",
        files: ["合格证:cert"]
      }
    ]);
  });

  it("选的文件夹本身就是一台设备、里面还有子文件夹：都算这台设备的，类别参考子文件夹名，标题带上子文件夹名", () => {
    expect(
      summary([
        "DG-1200-03/合格证/扫描件1.jpg",
        "DG-1200-03/维修记录/2025.xlsx",
        "DG-1200-03/总览.pdf"
      ])
    ).toEqual([
      {
        folder: "DG-1200-03",
        deviceId: 1,
        matchedBy: "code",
        files: [
          "合格证 - 扫描件1:cert",
          "维修记录 - 2025:maintenance",
          "总览:other"
        ]
      }
    ]);
  });

  it("设备文件夹里更深的子文件夹：归到那台设备，类别参考子文件夹名", () => {
    expect(
      summary(["资料/老三号/检测报告/2026年.pdf", "资料/SB-0009/a.pdf"])
    ).toEqual([
      {
        folder: "老三号",
        deviceId: 1,
        matchedBy: "name",
        files: ["检测报告 - 2026年:report"]
      },
      { folder: "SB-0009", deviceId: 3, matchedBy: "code", files: ["a:other"] }
    ]);
  });

  it("一次拖进来几个文件夹：各自一组", () => {
    expect(summary(["老三号/a.pdf", "SB-0010 泥浆泵/b.pdf"])).toEqual([
      { folder: "老三号", deviceId: 1, matchedBy: "name", files: ["a:other"] },
      {
        folder: "SB-0010 泥浆泵",
        deviceId: 4,
        matchedBy: "code",
        files: ["b:other"]
      }
    ]);
  });

  it("编号互相包含时取最长的；重名的设备不猜", () => {
    expect(
      summary(["资料/DG-1200-031 土压/a.pdf", "资料/泥浆泵/b.pdf"])
    ).toEqual([
      {
        folder: "DG-1200-031 土压",
        deviceId: 2,
        matchedBy: "code",
        files: ["a:other"]
      },
      { folder: "泥浆泵", deviceId: null, matchedBy: null, files: ["b:other"] }
    ]);
  });

  it("编号不分大小写；没有文件夹的散文件归到一组", () => {
    expect(summary(["资料/dg-1200-03/a.pdf"])[0]).toMatchObject({
      deviceId: 1,
      matchedBy: "code"
    });
    expect(summary(["a.pdf", "b.pdf"])).toEqual([
      {
        folder: "",
        deviceId: null,
        matchedBy: null,
        files: ["a:other", "b:other"]
      }
    ]);
  });

  it("什么都没有时返回空", () => {
    expect(groupFolderImport([], devices)).toEqual([]);
    expect(summary(["资料/.DS_Store"])).toEqual([]);
  });
});

describe("isJunkFile", () => {
  it("系统文件和 Office 临时文件算，正常文件不算", () => {
    for (const name of [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      "~$说明书.docx"
    ]) {
      expect(isJunkFile(name)).toBe(true);
    }
    expect(isJunkFile("说明书.docx")).toBe(false);
    expect(isJunkFile("README")).toBe(false);
  });
});

describe("uploadProblem", () => {
  const config: DocLibraryConfig = {
    part_size: 8 * MB,
    max_bytes: 2048 * MB,
    max_bytes_miniapp: 200 * MB,
    categories: [],
    extensions: ["pdf", "jpg", "docx"]
  };

  it("能传的文件没有问题", () => {
    expect(uploadProblem({ name: "合格证.PDF", size: 1024 }, config)).toBe("");
    expect(uploadProblem({ name: "a.pdf", size: 2048 * MB }, config)).toBe("");
  });
  it("不支持的类型、没有扩展名", () => {
    expect(uploadProblem({ name: "a.exe", size: 10 }, config)).toBe(
      "不支持 .exe 文件"
    );
    expect(uploadProblem({ name: "README", size: 10 }, config)).toBe(
      "不支持没有扩展名的文件"
    );
  });
  it("空文件", () => {
    expect(uploadProblem({ name: "a.pdf", size: 0 }, config)).toBe(
      "文件是空的"
    );
  });
  it("超过上限", () => {
    expect(uploadProblem({ name: "a.pdf", size: 2048 * MB + 1 }, config)).toBe(
      "文件超过 2 GB 的上限"
    );
  });
});
