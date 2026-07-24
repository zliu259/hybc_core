import { describe, expect, it } from "vitest";

import routerIndexSource from "./index.ts?raw";

describe("静态路由模块扫描", () => {
  it("不会把测试文件导入生产路由", () => {
    expect(routerIndexSource).toContain('"!./modules/**/*.test.ts"');
    expect(routerIndexSource).toContain('"!./modules/**/*.spec.ts"');
  });
});
