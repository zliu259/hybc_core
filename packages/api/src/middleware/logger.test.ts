import { describe, expect, it } from "vitest";

import { loggablePath } from "./logger";

describe("请求日志里的路径", () => {
  it("对外链接的令牌不写进日志", () => {
    const token = "a".repeat(43);
    expect(loggablePath(`/api/v1/doc-library/shared/${token}`)).toBe(
      "/api/v1/doc-library/shared/***"
    );
    expect(loggablePath(`/api/v1/doc-library/shared/${token}/extra`)).toBe(
      "/api/v1/doc-library/shared/***"
    );
    // 作废接口的路径里也有令牌
    expect(loggablePath(`/api/v1/doc-library/share/${token}`)).toBe(
      "/api/v1/doc-library/share/***"
    );
  });

  it("其他路径原样记录", () => {
    for (const path of [
      "/api/v1/doc-library/file/12",
      "/api/v1/doc-library/shared",
      "/api/v1/doc-library/shared/",
      "/api/v1/doc-library/file/12/share",
      "/api/v1/warehouse/device/3"
    ]) {
      expect(loggablePath(path)).toBe(path);
    }
  });
});
