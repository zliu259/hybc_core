import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, buildUrl, HybcApiClient } from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

describe("buildUrl", () => {
  it("joins base + path and appends non-empty query", () => {
    const url = buildUrl("https://api.hybcdg.com", "/api/v1/project", {
      keyword: "road",
      page: 2,
      status: undefined,
      empty: ""
    });
    expect(url).toBe("https://api.hybcdg.com/api/v1/project?keyword=road&page=2");
  });
});

describe("HybcApiClient", () => {
  it("GET unwraps {data, pagination} and sends Bearer token", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe("https://api.hybcdg.com/api/v1/project?page=1");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer hybc_agent_x"
      );
      return jsonResponse({
        success: true,
        data: [{ id: 1 }],
        pagination: { page: 1, pageSize: 20, total: 1 }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new HybcApiClient("https://api.hybcdg.com", "hybc_agent_x");
    const res = await client.get<Array<{ id: number }>>("/project", { page: 1 });
    expect(res.data).toEqual([{ id: 1 }]);
    expect(res.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
  });

  it("throws ApiError with server message on {success:false}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ success: false, error: { message: "Forbidden" } }, 403)
      )
    );
    const client = new HybcApiClient("https://api.hybcdg.com", "t");
    await expect(client.get("/payment/console-summary")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Forbidden"
    });
  });

  it("POST sends JSON body and works without a token", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ device_code: "d1" });
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
      return jsonResponse({ success: true, data: { status: "authorization_pending" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HybcApiClient("https://api.hybcdg.com", null);
    const res = await client.post<{ status: string }>("/agent/device/token", {
      device_code: "d1"
    });
    expect(res.data.status).toBe("authorization_pending");
  });

  it("normalizes a path without a leading slash", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      expect(input).toBe("https://api.hybcdg.com/api/v1/project");
      return jsonResponse({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new HybcApiClient("https://api.hybcdg.com", "t");
    await client.get("project");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("falls back to HTTP status when error message is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: { message: "" } }, 500))
    );
    const client = new HybcApiClient("https://api.hybcdg.com", "t");
    await expect(client.get("/x")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "HTTP 500"
    });
  });
});
