import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/upload", () => ({
  createUploadSignature: vi.fn(),
  resolveUploadUrl: (url: string) => url
}));
vi.mock("@/utils/auth", () => ({
  getToken: () => ({ accessToken: "t" }),
  formatToken: (token: string) => `Bearer ${token}`
}));
vi.mock("@/utils/message", () => ({ message: vi.fn() }));

// el-table 依赖 ResizeObserver；happy-dom 不一定提供
if (typeof globalThis.ResizeObserver === "undefined") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

vi.stubEnv("VITE_API_BASE_URL", "https://api-relay.hybcdg.com");

import PhaseUpload from "./index.vue";

describe("PhaseUpload attachment links", () => {
  it("「查看」链接把后端签发的 api.hybcdg.com 绝对地址归一到当前 API 基址", async () => {
    const wrapper = mount(PhaseUpload, {
      props: {
        modelValue: [
          {
            name: "a.pdf",
            key: "common/k.pdf",
            url: "https://api.hybcdg.com/api/v1/upload/object/common%2Fk.pdf"
          }
        ]
      },
      global: { plugins: [ElementPlus] }
    });
    await nextTick();
    await nextTick();

    const link = wrapper.find("a.el-link");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe(
      "https://api-relay.hybcdg.com/api/v1/upload/object/common%2Fk.pdf"
    );
  });
});
