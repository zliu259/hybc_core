import { beforeEach, describe, expect, it } from "vitest";

import { getAppFetcher, resetAppFetcher, setAppFetcher } from "./app-ref";

describe("app-ref", () => {
  beforeEach(() => resetAppFetcher());

  it("returns the registered fetcher", async () => {
    setAppFetcher(async () => new Response("ok"));
    const fetcher = getAppFetcher();
    const res = await fetcher(new Request("https://x/"), {} as never);
    expect(await res.text()).toBe("ok");
  });

  it("throws a clear error when nothing is registered", () => {
    expect(() => getAppFetcher()).toThrow(/app fetcher not registered/i);
  });

  it("lets a later registration replace an earlier one", async () => {
    setAppFetcher(async () => new Response("first"));
    setAppFetcher(async () => new Response("second"));
    const res = await getAppFetcher()(new Request("https://x/"), {} as never);
    expect(await res.text()).toBe("second");
  });
});
