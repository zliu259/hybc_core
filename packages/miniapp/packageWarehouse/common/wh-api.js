/** 库房分包的请求封装：统一前缀、拼查询串、生成库房单的请求号。 */
const { request } = require("../../utils/request");

const BASE = "/api/v1/warehouse";
/** 设备资料库的接口不在 /warehouse 下面 */
const DOC_BASE = "/api/v1/doc-library";

/**
 * 对象 → 查询串；undefined、null、空串不带。
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
const toQuery = (query) => {
  const pairs = Object.entries(query || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
};

/**
 * GET，返回整个响应（data、pagination）。
 * @param {string} path 以 / 开头，不带 /api/v1/warehouse
 * @param {Record<string, unknown>} [query]
 */
const whGet = (path, query) => request({ method: "GET", path: `${BASE}${path}${toQuery(query)}` });

/**
 * POST / PUT / DELETE。
 * @param {"POST" | "PUT" | "DELETE"} method
 * @param {string} path
 * @param {object} [data]
 */
const whSend = (method, path, data) => request({ method, path: `${BASE}${path}`, data });

/**
 * 设备资料库的 GET。
 * @param {string} path 以 / 开头，不带 /api/v1/doc-library
 * @param {Record<string, unknown>} [query]
 */
const docGet = (path, query) =>
  request({ method: "GET", path: `${DOC_BASE}${path}${toQuery(query)}` });

/**
 * 设备资料库的 POST / PUT / DELETE。
 * @param {"POST" | "PUT" | "DELETE"} method
 * @param {string} path
 * @param {object} [data]
 */
const docSend = (method, path, data) => request({ method, path: `${DOC_BASE}${path}`, data });

/**
 * 库房单的 client_request_id：录单页打开时生成一次，提交失败重试用同一个。
 * @returns {string}
 */
const newRequestId = () => {
  let random = "";
  for (let index = 0; index < 12; index += 1) {
    random += Math.floor(Math.random() * 16).toString(16);
  }
  return `${Date.now().toString(36)}-${random}`;
};

module.exports = { whGet, whSend, docGet, docSend, newRequestId, toQuery };
