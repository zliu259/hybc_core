import { describe, expect, it } from "vitest";
import { normalizeApiUrl } from "./api-url";

const base = "https://api-relay.hybcdg.com";

describe("normalizeApiUrl", () => {
  it("旧绝对地址换到当前基址，路径与查询串保留", () => {
    expect(
      normalizeApiUrl(
        "https://api.hybcdg.com/api/v1/upload/object/a%2Fb.pdf?expires=1&signature=s",
        base
      )
    ).toBe(
      "https://api-relay.hybcdg.com/api/v1/upload/object/a%2Fb.pdf?expires=1&signature=s"
    );
  });

  it("相对路径拼接基址", () => {
    expect(normalizeApiUrl("/api/v1/upload/object/k", base)).toBe(
      "https://api-relay.hybcdg.com/api/v1/upload/object/k"
    );
    expect(normalizeApiUrl("api/v1/x", base)).toBe(
      "https://api-relay.hybcdg.com/api/v1/x"
    );
  });

  it("基址为空（本地开发）时一切原样", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com/x", "")).toBe(
      "https://api.hybcdg.com/x"
    );
    expect(normalizeApiUrl("/api/v1/x", "")).toBe("/api/v1/x");
  });

  it("不是旧 origin 的绝对地址原样，包括前缀相似的恶意域与 blob:", () => {
    expect(normalizeApiUrl("https://api.hybcdg.com.evil.com/x", base)).toBe(
      "https://api.hybcdg.com.evil.com/x"
    );
    expect(normalizeApiUrl("https://files.example.com/x", base)).toBe(
      "https://files.example.com/x"
    );
    expect(normalizeApiUrl("blob:https://web.hybcdg.com/uuid", base)).toBe(
      "blob:https://web.hybcdg.com/uuid"
    );
    expect(normalizeApiUrl("data:text/plain;base64,aGk=", base)).toBe(
      "data:text/plain;base64,aGk="
    );
  });

  it("空值原样", () => {
    expect(normalizeApiUrl("", base)).toBe("");
  });

  it("基址与旧 origin 相同（切换前）时等价于不改写", () => {
    expect(
      normalizeApiUrl("https://api.hybcdg.com/x", "https://api.hybcdg.com")
    ).toBe("https://api.hybcdg.com/x");
  });

  it("基址尾部斜杠不会产生双斜杠", () => {
    expect(normalizeApiUrl("/api/v1/x", "https://api-relay.hybcdg.com/")).toBe(
      "https://api-relay.hybcdg.com/api/v1/x"
    );
    expect(
      normalizeApiUrl(
        "https://api.hybcdg.com/x",
        "https://api-relay.hybcdg.com/"
      )
    ).toBe("https://api-relay.hybcdg.com/x");
  });
});
