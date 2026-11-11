import { beforeEach, describe, expect, it, vi } from "vitest";

const messages = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));

vi.mock("@/utils/message", () => ({
  message: (text: string, options: unknown) => {
    messages.calls.push([text, options]);
  }
}));

import { useWhAction } from "./useWhAction";

describe("useWhAction", () => {
  beforeEach(() => {
    messages.calls = [];
  });

  it("失败时弹出后端给的中文错误，busy 复位，返回 undefined", async () => {
    const { busy, run } = useWhAction();
    const pending = run(async () => {
      expect(busy.value).toBe(true);
      throw {
        response: {
          data: {
            success: false,
            error: { message: "库存不足：卡扣 DN114，在库 3" }
          }
        }
      };
    });
    expect(await pending).toBeUndefined();
    expect(busy.value).toBe(false);
    expect(messages.calls).toEqual([
      ["库存不足：卡扣 DN114，在库 3", { type: "error" }]
    ]);
  });

  it("成功时返回结果并弹出成功提示", async () => {
    const { busy, run } = useWhAction();
    expect(await run(async () => 42, { success: "已保存" })).toBe(42);
    expect(busy.value).toBe(false);
    expect(messages.calls).toEqual([["已保存", { type: "success" }]]);
  });

  it("没有后端文案时用通用提示", async () => {
    const { run } = useWhAction();
    await run(async () => {
      throw { response: { data: {} } };
    });
    expect(messages.calls[0][0]).toBe("操作失败，请稍后重试");
  });
});
