import { Hono } from "hono";

import { reimbursementRoutes } from "../../src/routes/reimbursement";
import { createReimbursementHarness } from "./reimbursement-harness";

// 用到它的测试文件要自己 vi.mock("../src/services/auth")，这里只负责发请求。

export const createRouteHarness = (options) => {
  const h = createReimbursementHarness(options);
  const realGet = h.env.KV.get;
  h.env.KV.get = async (key) => (await realGet(key)) ?? "session";
  return h;
};

export const callReimbursement = (h, method, path, body, headers = {}) => {
  const app = new Hono();
  app.route("/reimbursement", reimbursementRoutes);
  return app.request(
    `/reimbursement${path}`,
    {
      method,
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    },
    h.env
  );
};
