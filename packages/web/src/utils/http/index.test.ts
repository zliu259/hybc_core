import {
  AxiosError,
  type AxiosAdapter,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// 集成测试：主入口失败 → relay pool 回退到直连 Worker → 调用方拿到的仍是 {success, data}。
// 用自定义 axios adapter 替代网络；其余拦截器、relay-pool、策略函数都是真实代码。
// ---------------------------------------------------------------------------

const PRIMARY = "https://api-relay.hybcdg.com";
const DIRECT = "https://api.hybcdg.com";

const adapterCalls: InternalAxiosRequestConfig[] = [];
let adapterImpl: (
  config: InternalAxiosRequestConfig
) => Promise<AxiosResponse> = () => Promise.reject(new Error("unset"));

const testAdapter: AxiosAdapter = config => {
  adapterCalls.push(config);
  return adapterImpl(config);
};

vi.mock("axios", async importOriginal => {
  const actual = await importOriginal<typeof import("axios")>();
  const realCreate = actual.default.create.bind(actual.default);
  const mocked = {
    ...actual.default,
    create: (config?: AxiosRequestConfig) =>
      realCreate({ ...config, adapter: testAdapter })
  };
  return { ...actual, default: mocked };
});

vi.mock("@/config", () => {
  const pool = {
    enabled: true,
    maxAttempts: 1,
    nodes: [
      {
        id: "direct-worker",
        baseUrl: DIRECT,
        priority: 10,
        enabled: true,
        statusPath: "/api/v1/system/health",
        supportsWriteFallback: false,
        probeTimeoutMs: 3000
      }
    ]
  };
  return {
    getConfig: (key?: string) => {
      if (key === "ApiRelayPool") return pool;
      if (key === "ApiRelayPool.maxAttempts") return pool.maxAttempts;
      return undefined;
    }
  };
});

vi.mock("@/store/modules/user", () => ({
  useUserStoreHook: () => ({ handRefreshToken: vi.fn() })
}));

vi.mock("@/utils/auth", () => ({
  getToken: () => undefined,
  formatToken: (token: string) => `Bearer ${token}`,
  removeToken: vi.fn()
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.stubEnv("VITE_API_BASE_URL", PRIMARY);

const { http } = await import("./index");

const okBody = { success: true, data: { items: [1, 2] } };

const respond = (
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown
): AxiosResponse => ({
  data,
  status,
  statusText: String(status),
  headers: {},
  config
});

const gatewayError = (config: InternalAxiosRequestConfig, status: number) =>
  new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    respond(config, status, "upstream failed")
  );

const networkError = (config: InternalAxiosRequestConfig) =>
  new AxiosError("Network Error", AxiosError.ERR_NETWORK, config);

describe("http relay fallback (integration)", () => {
  beforeEach(() => {
    adapterCalls.length = 0;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
  });

  it("主入口 503 → 直连 Worker 200：调用方拿到完整 {success, data}，重试带回退标记头", async () => {
    adapterImpl = config => {
      if (config.baseURL === PRIMARY)
        return Promise.reject(gatewayError(config, 503));
      return Promise.resolve(respond(config, 200, okBody));
    };

    const result = await http.request<typeof okBody>("get", "/api/v1/things");

    expect(result).toEqual(okBody);
    expect(adapterCalls.map(c => c.baseURL)).toEqual([PRIMARY, DIRECT]);
    expect(adapterCalls[1]?.headers["X-Relay-Fallback"]).toBe("1");
    expect(adapterCalls[1]?.headers["X-Relay-Id"]).toBe("direct-worker");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("主入口网络错误 → 直连 Worker 200：同样回退成功", async () => {
    adapterImpl = config => {
      if (config.baseURL === PRIMARY)
        return Promise.reject(networkError(config));
      return Promise.resolve(respond(config, 200, okBody));
    };

    const result = await http.request<typeof okBody>("get", "/api/v1/things");

    expect(result).toEqual(okBody);
    expect(adapterCalls).toHaveLength(2);
  });

  it("不带 Idempotency-Key 的 POST 主入口 503：不重放，错误原样抛出", async () => {
    adapterImpl = config => Promise.reject(gatewayError(config, 503));

    await expect(
      http.request("post", "/api/v1/things", { data: { a: 1 } })
    ).rejects.toMatchObject({ response: { status: 503 } });
    expect(adapterCalls).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("业务 4xx 不回退：401 原样抛出且不探测", async () => {
    adapterImpl = config => Promise.reject(gatewayError(config, 401));

    await expect(http.request("get", "/api/v1/things")).rejects.toMatchObject({
      response: { status: 401 }
    });
    expect(adapterCalls).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
