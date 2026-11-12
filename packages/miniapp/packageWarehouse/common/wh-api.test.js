/** 库房分包的请求封装。运行：node packageWarehouse/common/wh-api.test.js */
const assert = require("assert");
const path = require("path");

const calls = [];
const resolved = require.resolve(path.join(__dirname, "../../utils/request.js"));
require.cache[resolved] = {
  id: resolved,
  filename: resolved,
  loaded: true,
  exports: {
    request: async (options) => {
      calls.push(options);
      return { success: true, data: [], pagination: { total: 0 } };
    }
  }
};

const { whGet, whSend, docGet, docSend, newRequestId, toQuery } = require("./wh-api");

const run = async () => {
  const result = await whGet("/task", { scope: "mine", status: "", page: 1, keyword: "排泥 管", kind: undefined, x: null });
  assert.deepStrictEqual(result, { success: true, data: [], pagination: { total: 0 } });
  assert.deepStrictEqual(calls[0], {
    method: "GET",
    path: "/api/v1/warehouse/task?scope=mine&page=1&keyword=%E6%8E%92%E6%B3%A5%20%E7%AE%A1"
  });

  await whGet("/me");
  assert.strictEqual(calls[1].path, "/api/v1/warehouse/me");

  await whSend("POST", "/doc", { a: 1 });
  assert.deepStrictEqual(calls[2], { method: "POST", path: "/api/v1/warehouse/doc", data: { a: 1 } });

  await whSend("DELETE", "/task/9/photo/5");
  assert.deepStrictEqual(calls[3], { method: "DELETE", path: "/api/v1/warehouse/task/9/photo/5", data: undefined });

  // 设备资料库的接口在另一个前缀下
  await docGet("/file", { doc_category: "cert", keyword: "", page: 1 });
  assert.deepStrictEqual(calls[4], { method: "GET", path: "/api/v1/doc-library/file?doc_category=cert&page=1" });
  await docGet("/for-device/7");
  assert.strictEqual(calls[5].path, "/api/v1/doc-library/for-device/7");
  await docSend("POST", "/upload/init", { file_name: "a.pdf", file_size: 3 });
  assert.deepStrictEqual(calls[6], {
    method: "POST",
    path: "/api/v1/doc-library/upload/init",
    data: { file_name: "a.pdf", file_size: 3 }
  });

  assert.strictEqual(toQuery({}), "");
  assert.strictEqual(toQuery({ a: 0, b: false }), "?a=0&b=false");

  const first = newRequestId();
  const second = newRequestId();
  assert.notStrictEqual(first, second);
  assert.ok(first.length >= 8 && first.length <= 64, first);
  assert.ok(/^[0-9a-z]+-[0-9a-f]{12}$/.test(first), first);

  console.log("wh-api tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
