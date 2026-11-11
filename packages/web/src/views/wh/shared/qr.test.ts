import { describe, expect, it } from "vitest";

import { deviceQrPayload, parseDeviceQr } from "./qr";

describe("设备二维码", () => {
  it("生成和解析互逆，别的内容返回 null", () => {
    expect(deviceQrPayload("SB-0012")).toBe("HYBC:D:SB-0012");
    expect(parseDeviceQr("HYBC:D:SB-0012")).toBe("SB-0012");
    expect(parseDeviceQr("  HYBC:D:DN1550-1 ")).toBe("DN1550-1");
    expect(parseDeviceQr("https://example.com/12")).toBeNull();
    expect(parseDeviceQr("HYBC:D:")).toBeNull();
  });
});
