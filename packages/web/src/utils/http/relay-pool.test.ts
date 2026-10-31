import { beforeEach, describe, expect, it, vi } from "vitest";

// 与 public/platform-config.json 的 ApiRelayPool 同款：直连 Worker 作为唯一回退节点。
const pool = {
  enabled: true,
  maxAttempts: 1,
  nodes: [
    {
      id: "direct-worker",
      baseUrl: "https://api.hybcdg.com",
      priority: 10,
      enabled: true,
      statusPath: "/api/v1/system/health",
      supportsWriteFallback: false,
      probeTimeoutMs: 3000
    }
  ]
};

vi.mock("@/config", () => ({
  getConfig: (key?: string) => {
    if (key === "ApiRelayPool") return pool;
    if (key === "ApiRelayPool.maxAttempts") return pool.maxAttempts;
    return undefined;
  }
}));

import { getRelayCandidates } from "./relay-pool";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const healthResponse = () =>
  new Response(JSON.stringify({ ok: true, service: "api" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

describe("getRelayCandidates with direct-worker fallback node", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(healthResponse());
  });

  it("基址仍是直连 Worker 时（切换前）候选为空，且不发探测", async () => {
    const candidates = await getRelayCandidates(
      "get",
      {},
      "https://api.hybcdg.com"
    );
    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("基址为 api-relay 时直连 Worker 成为候选，探测打 /api/v1/system/health", async () => {
    const candidates = await getRelayCandidates(
      "get",
      {},
      "https://api-relay.hybcdg.com"
    );
    expect(candidates.map(node => node.id)).toEqual(["direct-worker"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.hybcdg.com/api/v1/system/health"
    );
  });

  it("不带 Idempotency-Key 的 POST 没有候选，且不发探测", async () => {
    const candidates = await getRelayCandidates(
      "post",
      {},
      "https://api-relay.hybcdg.com"
    );
    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("带 Idempotency-Key 的 POST 仍因 supportsWriteFallback=false 没有候选", async () => {
    const candidates = await getRelayCandidates(
      "post",
      { "Idempotency-Key": "k-1" },
      "https://api-relay.hybcdg.com"
    );
    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
