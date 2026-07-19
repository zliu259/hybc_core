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

// ── 终审 MEDIUM 1：传输层异常不得裸抛 ────────────────────────────────
// 服务端是「先落库提交 → waitUntil 推卡片 → 才返回 202」。响应回程断掉时，
// 动作【已经 park 成功、卡片已推到员工微信】，agent 却只看到 fetch failed。
// 裸抛会让 agent 默认重试 → 第二张一模一样的卡片、第二个待确认名额。
describe("传输层失败（非 ApiError）", () => {
  it("approve_task 不裸抛，返回结构化结果并明令不要重发", async () => {
    const post = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const t = toolOf("approve_task", clientWith(post));
    const out = parse(await t.handler({ id: 42, comment: "同意" }));
    const text = JSON.stringify(out);
    expect(out.status).toBe("unknown");
    expect(text).toContain("不要重发");
    expect(text).toContain("可能");
    expect(text).toContain("check_pending");
    expect(out.error).toContain("fetch failed");
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("reject_task 同样不裸抛", async () => {
    const post = vi.fn(async () => {
      throw new Error("network timeout");
    });
    const t = toolOf("reject_task", clientWith(post));
    const out = parse(await t.handler({ id: 9 }));
    expect(out.status).toBe("unknown");
    expect(JSON.stringify(out)).toContain("不要重发");
  });

  it("check_pending 传输失败可稍后再查（只读，无副作用）", async () => {
    const get = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    const out = parse(await t.handler({ pending_action_id: "6f1e5b3c-0000-4000-8000-000000000001" }));
    expect(out.error).toContain("fetch failed");
    expect(JSON.stringify(out)).toContain("稍后再查");
  });
});

// ── 终审 MEDIUM 2：comment 会以员工本人名义写进正式审批记录 ──────────
describe("comment 的 schema 描述", () => {
  it("写明以员工本人名义落库、不得第一人称代入 agent 自己", () => {
    const defs = approvalWriteTools(clientWith(vi.fn()));
    for (const name of ["approve_task", "reject_task"]) {
      const desc = defs.find((d) => d.name === name)!.inputSchema.comment.description ?? "";
      expect(desc).toContain("本人名义");
      expect(desc).toContain("审批记录");
      expect(desc).toContain("第一人称");
    }
  });
});

// ── 终审 MEDIUM 3：两种限额的指引必须分开 ────────────────────────────
// 服务端有「在途上限」与「滚动 24h 预算」两种；对后者，处理掉卡片不会退还额度。
// 注意：park 拒绝时 data.reason 带原因，但 api-client 在 success:false 时直接抛
// ApiError 并丢弃信封，客户端只拿得到 error.message，故只能据文案区分。
describe("429 两种限额", () => {
  const run = async (message: string) => {
    const { ApiError } = await import("../api-client.js");
    const post = vi.fn(async () => {
      throw new ApiError(message, 429);
    });
    return parse(await toolOf("approve_task", clientWith(post)).handler({ id: 1 }));
  };

  it("在途触顶：指引先去处理已有卡片", async () => {
    const out = await run("待确认的高危动作已达在途上限（5 条），请先在企业微信里处理已推送的确认卡片，再重试本次操作。");
    expect(out.hint).toContain("处理");
    expect(out.hint).not.toContain("窗口");
  });

  it("滚动预算触顶：必须说明处理卡片不会恢复额度，只能等窗口", async () => {
    const out = await run("该授权在过去 24 小时内发起的高危动作已达上限（20 次），请稍后再试；若非本人操作请立即在网页端吊销该授权。");
    expect(out.hint).toContain("窗口");
    expect(out.hint).toContain("不会");
    expect(out.hint).not.toContain("先去企业微信处理");
  });

  it("认不出的 429：给中性且不误导的说法", async () => {
    const out = await run("rate limited");
    expect(out.hint).toContain("原文");
    expect(out.hint).not.toContain("处理掉已有卡片即可继续");
  });
});

// ── 终审 LOW 5：pending_action_id 未校验未编码就拼进路径 ──────────────
describe("pending_action_id 输入校验", () => {
  it("schema 拒绝非 uuid（含路径穿越）", () => {
    const schema = approvalWriteTools(clientWith(vi.fn())).find((d) => d.name === "check_pending")!
      .inputSchema.pending_action_id;
    expect(schema.safeParse("../../projects/1").success).toBe(false);
    expect(schema.safeParse("nope").success).toBe(false);
    expect(schema.safeParse("6f1e5b3c-0000-4000-8000-000000000001").success).toBe(true);
  });

  it("拼接处做 encodeURIComponent，穿越取值打不到别的端点", async () => {
    const get = vi.fn(async () => ({ data: { status: "pending" } }));
    const t = toolOf("check_pending", clientWith(vi.fn(), get));
    await t.handler({ pending_action_id: "../projects/1" });
    expect(get).toHaveBeenCalledWith("/agent/pending/..%2Fprojects%2F1");
  });
});

// ── 终审 LOW 6：check_pending 是只读，重试无副作用 ────────────────────
describe("check_pending 的错误指引", () => {
  const run = async (message: string, status: number) => {
    const { ApiError } = await import("../api-client.js");
    const get = vi.fn(async () => {
      throw new ApiError(message, status);
    });
    return parse(
      await toolOf("check_pending", clientWith(vi.fn(), get)).handler({
        pending_action_id: "6f1e5b3c-0000-4000-8000-000000000001"
      })
    );
  };

  it("404：如实说查不到，不得读成仍在等待", async () => {
    const out = await run("not found", 404);
    expect(out.hint).toContain("查不到");
    expect(out.hint).toContain("等待");
  });

  it("5xx：属瞬时错误，应提示可稍后再查而非放弃", async () => {
    const out = await run("internal error", 500);
    expect(out.hint).toContain("稍后再查");
    expect(out.hint).not.toContain("不要重试");
  });
});
