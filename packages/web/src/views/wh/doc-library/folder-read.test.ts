import { describe, expect, it } from "vitest";

import {
  fromInputFiles,
  readDroppedEntries,
  type EntryLike
} from "./folder-read";

const fileEntry = (name: string, broken = false): EntryLike => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (resolve, reject) =>
    broken ? reject(new Error("读不了")) : resolve(new File(["x"], name))
});
/** 文件夹；batch 是 readEntries 一次最多给几个（浏览器一次最多给 100 个，要读到空为止） */
const dirEntry = (
  name: string,
  children: EntryLike[],
  batch = 2
): EntryLike => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let offset = 0;
    return {
      readEntries: resolve => {
        const next = children.slice(offset, offset + batch);
        offset += batch;
        resolve(next);
      }
    };
  }
});

describe("readDroppedEntries", () => {
  it("递归读出文件夹里的所有文件，路径带上各级文件夹名", async () => {
    const picked = await readDroppedEntries([
      dirEntry("资料", [
        fileEntry("总说明.pdf"),
        dirEntry("老三号", [
          fileEntry("合格证.pdf"),
          dirEntry("维修", [fileEntry("2025.xlsx")])
        ]),
        fileEntry("a.pdf"),
        fileEntry("b.pdf"),
        fileEntry("c.pdf")
      ]),
      fileEntry("散文件.pdf")
    ]);
    expect(picked.map(item => item.path).sort()).toEqual(
      [
        "散文件.pdf",
        "资料/a.pdf",
        "资料/b.pdf",
        "资料/c.pdf",
        "资料/总说明.pdf",
        "资料/老三号/合格证.pdf",
        "资料/老三号/维修/2025.xlsx"
      ].sort()
    );
    expect(picked.every(item => item.file instanceof File)).toBe(true);
  });

  it("读不了的文件跳过，其余照常", async () => {
    const picked = await readDroppedEntries([
      dirEntry("资料", [fileEntry("坏的.pdf", true), fileEntry("好的.pdf")])
    ]);
    expect(picked.map(item => item.path)).toEqual(["资料/好的.pdf"]);
  });

  it("什么都没拖进来返回空", async () => {
    expect(await readDroppedEntries([])).toEqual([]);
  });
});

describe("fromInputFiles", () => {
  it("用选文件夹时浏览器给的相对路径；没有的用文件名", () => {
    const inFolder = new File(["x"], "合格证.pdf");
    Object.defineProperty(inFolder, "webkitRelativePath", {
      value: "资料/老三号/合格证.pdf"
    });
    const loose = new File(["x"], "散.pdf");
    expect(fromInputFiles([inFolder, loose]).map(item => item.path)).toEqual([
      "资料/老三号/合格证.pdf",
      "散.pdf"
    ]);
  });
});
