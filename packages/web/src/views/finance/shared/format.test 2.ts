import { describe, expect, it } from "vitest";
import { mergeRemarkEditLog } from "./format";

describe("mergeRemarkEditLog", () => {
  const log = "[超管修改 2026-10-01T02:03:04.000Z] admin：改账户";

  it("改备注时保留系统修改记录", () => {
    expect(mergeRemarkEditLog(" 新备注 ", `旧备注\n${log}`)).toBe(
      `新备注\n${log}`
    );
  });

  it("备注清空时只留修改记录，没有记录时就是空串", () => {
    expect(mergeRemarkEditLog("", `旧备注\n${log}`)).toBe(log);
    expect(mergeRemarkEditLog("", "旧备注")).toBe("");
    expect(mergeRemarkEditLog("新备注", null)).toBe("新备注");
  });
});

describe("mergeRemarkEditLog：作废和激活记录也要保留", () => {
  it("保存时不能把 VOID、REACTIVATE 行冲掉", () => {
    const original =
      "旧备注\n[VOID 2026-03-16T05:58:05.444Z] boss\n[REACTIVATE 2026-03-16T06:17:25.639Z] boss";
    expect(mergeRemarkEditLog("新备注", original)).toBe(
      "新备注\n[VOID 2026-03-16T05:58:05.444Z] boss\n[REACTIVATE 2026-03-16T06:17:25.639Z] boss"
    );
  });
});
