import { describe, expect, it, vi } from "vitest";

import { approvalWriteTools } from "./approvals-write";

const clientWith = (post: unknown, get?: unknown) =>
  ({ post: post as never, get: (get ?? vi.fn()) as never }) as never;

const toolOf = (name: string, client: unknown) =>
  approvalWriteTools(client as never).find((t) => t.name === name)!;

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe("approve_task", () => {
  it("把 202 awaiting_confirmation 如实透传，并要求用户去微信确认", async () => {
    const post = vi.fn(async () => ({
      data: {
        pending_action_id: "p1",
        status: "awaiting_confirmation",
        summary: "批准审批单 #42",
        expires_at: "2026-07-19T02:10:00.000Z"
      }
    }));
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 42, comment: "同意" }));
    expect(post).toHaveBeenCalledWith("/approval/42/approve", { comment: "同意" });
    expect(out.status).toBe("awaiting_confirmation");
    expect(out.pending_action_id).toBe("p1");
    expect(JSON.stringify(out)).toContain("微信");
  });

  it("超额(429)时把原因如实交回，不重试", async () => {
    const { ApiError } = await import("../api-client.js");
    const post = vi.fn(async () => {
      throw new ApiError("待确认动作过多，请先处理", 429);
    });
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 42 }));
    expect(out.error).toContain("待确认动作过多");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("高危写未开放(403)时说明并引导网页端操作", async () => {
    const { ApiError } = await import("../api-client.js");
    const post = vi.fn(async () => {
      throw new ApiError("智能体令牌为只读，禁止写操作", 403);
    });
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 1 }));
    expect(out.error).toBeTruthy();
    expect(JSON.stringify(out)).toContain("网页");
  });

  it("comment 省略时不发送该字段", async () => {
    const post = vi.fn(async () => ({ data: { status: "awaiting_confirmation", pending_action_id: "p" } }));
    const t = toolOf("approve_task", clientWith(post));
    await t.handler({ id: 7 });
    expect(post).toHaveBeenCalledWith("/approval/7/approve", {});
  });
});

describe("reject_task", () => {
  it("打到 reject 端点", async () => {
    const post = vi.fn(async () => ({ data: { status: "awaiting_confirmation", pending_action_id: "p" } }));
    const t = toolOf("reject_task", clientWith(post));
    await t.handler({ id: 9, comment: "不同意" });
    expect(post).toHaveBeenCalledWith("/approval/9/reject", { comment: "不同意" });
  });
});

describe("check_pending", () => {
  it("查询待确认动作状态", async () => {
    const get = vi.fn(async () => ({ data: { id: "p1", status: "done", result: { status: 200 } } }));
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    const out = parse(await t.handler({ pending_action_id: "p1" }));
    expect(get).toHaveBeenCalledWith("/agent/pending/p1");
    expect(out.status).toBe("done");
  });

  it("找不到时如实报错而非假装还在等待", async () => {
    const { ApiError } = await import("../api-client.js");
    const get = vi.fn(async () => {
      throw new ApiError("not found", 404);
    });
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    const out = parse(await t.handler({ pending_action_id: "nope" }));
    expect(out.error).toBeTruthy();
  });
});

describe("工具描述", () => {
  it("三个工具都在，且写工具的描述写明需本人微信确认", () => {
    const defs = approvalWriteTools(clientWith(vi.fn()));
    expect(defs.map((d) => d.name).sort()).toEqual(["approve_task", "check_pending", "reject_task"]);
    const approve = defs.find((d) => d.name === "approve_task")!;
    expect(approve.description).toContain("确认");
  });
});
