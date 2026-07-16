import { describe, expect, it, vi } from "vitest";

import { runCli, serveUntilClosed, type CliDeps } from "./cli";

const baseDeps = (over: Partial<CliDeps> = {}): CliDeps => ({
  readCredentials: vi.fn(async () => null),
  saveCredentials: vi.fn(async () => undefined),
  clearCredentials: vi.fn(async () => undefined),
  runLogin: vi.fn(async () => ({
    token: "hybc_agent_x",
    wecomUserid: "MaxLiu",
    role: "finance"
  })),
  serve: vi.fn(async () => undefined),
  now: () => "2026-07-16T00:00:00.000Z",
  log: vi.fn(),
  ...over
});

describe("runCli", () => {
  it("login runs device flow and saves credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["login"], deps);
    expect(code).toBe(0);
    expect(deps.runLogin).toHaveBeenCalled();
    expect(deps.saveCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ token: "hybc_agent_x", wecomUserid: "MaxLiu" })
    );
  });

  it("logout clears credentials", async () => {
    const deps = baseDeps();
    const code = await runCli(["logout"], deps);
    expect(code).toBe(0);
    expect(deps.clearCredentials).toHaveBeenCalled();
  });

  it("whoami reports not-logged-in as exit 1", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli(["whoami"], deps);
    expect(code).toBe(1);
  });

  it("whoami with credentials reports identity and exits 0", async () => {
    const log = vi.fn();
    const deps = baseDeps({
      readCredentials: vi.fn(async () => ({
        baseUrl: "https://api.hybcdg.com",
        token: "hybc_agent_x",
        wecomUserid: "MaxLiu",
        role: "finance",
        savedAt: "s"
      })),
      log
    });
    const code = await runCli(["whoami"], deps);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("MaxLiu"));
  });

  it("serve without credentials exits 1 and does not start server", async () => {
    const deps = baseDeps({ readCredentials: vi.fn(async () => null) });
    const code = await runCli([], deps);
    expect(code).toBe(1);
    expect(deps.serve).not.toHaveBeenCalled();
  });

  it("serve with credentials starts the server", async () => {
    const deps = baseDeps({
      readCredentials: vi.fn(async () => ({
        baseUrl: "https://api.hybcdg.com",
        token: "hybc_agent_x",
        wecomUserid: "MaxLiu",
        role: "finance",
        savedAt: "s"
      }))
    });
    const code = await runCli(["serve"], deps);
    expect(code).toBe(0);
    expect(deps.serve).toHaveBeenCalledWith("https://api.hybcdg.com", "hybc_agent_x");
  });
});

describe("serveUntilClosed", () => {
  it("stays pending until the transport closes, then chains the protocol onclose", async () => {
    const events: string[] = [];
    const transport: { onclose?: () => void } = {};
    const server = {
      // 模拟 MCP SDK Protocol.connect：接管 transport.onclose 后立即 resolve
      connect: async (t: { onclose?: () => void }) => {
        t.onclose = () => events.push("protocol-onclose");
      }
    };

    let resolved = false;
    const done = serveUntilClosed(server, transport).then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 0));
    // P0 回归：connect resolve 后进程不能立刻退出
    expect(resolved).toBe(false);

    transport.onclose?.(); // 客户端断开 → transport 关闭
    await done;
    expect(resolved).toBe(true);
    // SDK 自身的关闭清理逻辑仍需被执行
    expect(events).toEqual(["protocol-onclose"]);
  });
});
