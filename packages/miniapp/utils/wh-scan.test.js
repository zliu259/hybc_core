/** 设备码解析和扫码查设备。运行：node utils/wh-scan.test.js */
const assert = require("assert");
const path = require("path");

const state = { scans: [], calls: [], responses: {} };

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};

stub("./wx.js", {
  wxScanCode: async () => {
    const next = state.scans.shift();
    if (next instanceof Error || (next && next.errMsg)) throw next;
    return { result: next };
  }
});
stub("./request.js", {
  request: async ({ path: requestPath }) => {
    state.calls.push(requestPath);
    const response = state.responses[requestPath];
    if (response instanceof Error) throw response;
    return response;
  }
});

const { DEVICE_CODE_PREFIX, parseDeviceCode, scanDevice } = require("./wh-scan");

const reset = () => {
  state.scans = [];
  state.calls = [];
  state.responses = {};
};

const rejects = async (promise, message) => {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `应该失败：${message}`);
  assert.strictEqual(caught.message, message);
};

const run = async () => {
  assert.strictEqual(DEVICE_CODE_PREFIX, "HYBC:D:");
  assert.deepStrictEqual(parseDeviceCode("HYBC:D:DG-1200-03"), { ok: true, code: "DG-1200-03" });
  assert.deepStrictEqual(parseDeviceCode("  hybc:d:DG-1200-03 \n"), { ok: true, code: "DG-1200-03" });
  assert.deepStrictEqual(parseDeviceCode("https://example.com/x"), { ok: false, message: "不是设备码" });
  assert.deepStrictEqual(parseDeviceCode("HYBC:D:"), { ok: false, message: "不是设备码" });
  assert.deepStrictEqual(parseDeviceCode("HYBC:D:   "), { ok: false, message: "不是设备码" });
  assert.deepStrictEqual(parseDeviceCode(undefined), { ok: false, message: "不是设备码" });
  assert.deepStrictEqual(parseDeviceCode(12345), { ok: false, message: "不是设备码" });

  // 扫到设备码且查得到
  reset();
  state.scans = ["HYBC:D:DG-1200-03"];
  state.responses["/api/v1/warehouse/device/by-code/DG-1200-03"] = {
    success: true,
    data: { id: 7, device_code: "DG-1200-03" }
  };
  assert.deepStrictEqual(await scanDevice(), { id: 7, device_code: "DG-1200-03" });
  assert.deepStrictEqual(state.calls, ["/api/v1/warehouse/device/by-code/DG-1200-03"]);

  // 编号里有空格、斜杠时要转义
  reset();
  state.scans = ["HYBC:D:顶管 1/2"];
  const encoded = `/api/v1/warehouse/device/by-code/${encodeURIComponent("顶管 1/2")}`;
  state.responses[encoded] = { success: true, data: { id: 8 } };
  assert.deepStrictEqual(await scanDevice(), { id: 8 });
  assert.deepStrictEqual(state.calls, [encoded]);

  // 用户取消：不提示、不请求
  reset();
  state.scans = [{ errMsg: "scanCode:fail cancel" }];
  assert.strictEqual(await scanDevice(), null);
  assert.deepStrictEqual(state.calls, []);

  // 扫到普通二维码
  reset();
  state.scans = ["https://example.com/x"];
  await rejects(scanDevice(), "不是设备码");
  assert.deepStrictEqual(state.calls, []);

  // 设备码查不到
  reset();
  state.scans = ["HYBC:D:DG-9999"];
  const notFound = new Error("设备不存在");
  notFound.__statusCode = 404;
  state.responses["/api/v1/warehouse/device/by-code/DG-9999"] = notFound;
  await rejects(scanDevice(), "没有这台设备：DG-9999");

  // 断网：原样抛出
  reset();
  state.scans = ["HYBC:D:DG-01"];
  state.responses["/api/v1/warehouse/device/by-code/DG-01"] = new Error("网络连接失败");
  await rejects(scanDevice(), "网络连接失败");

  // 相机打不开（不是取消）：给一句中文
  reset();
  state.scans = [{ errMsg: "scanCode:fail system permission denied" }];
  await rejects(scanDevice(), "扫码失败，请重试");

  console.log("wh-scan tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
