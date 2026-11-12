import { Hono } from "hono";
import { verify } from "hono/jwt";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { serveObject } from "../services/object-serve";
import {
  buildObjectUrl,
  buildSignedObjectUrl,
  getUploadBaseUrl,
  isObjectAccessSignatureValid,
  signObjectAccess
} from "../services/upload-signature";
import type { Env } from "../types/env";

/** 资料库的文件只能从资料库自己的接口上传和取地址，这两个通用签名接口不给签。 */
const DOC_LIBRARY_PREFIX = "doc-library/";
const isDocLibraryCategory = (category: string): boolean =>
  category === "doc-library" || category.startsWith(DOC_LIBRARY_PREFIX);

/** 库房这三类文件：读要签名或人的登录态，出去时用收紧的回包头。 */
const WAREHOUSE_PREFIXES = [DOC_LIBRARY_PREFIX, "wh-task/", "wh-doc/"];
const PROTECTED_PREFIXES = ["contract-draft/", "legacy/fin/", ...WAREHOUSE_PREFIXES];

const parseFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
};

export const uploadRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

uploadRoutes.post("/sign", authMiddleware, async (c) => {
  const body = (await c.req.json()) as {
    fileName: string;
    contentType?: string;
    category?: string;
  };

  if (isDocLibraryCategory(String(body.category ?? ""))) {
    return c.json({ success: false, error: { message: "资料请从资料库上传" } }, 400);
  }

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const safeName = parseFileName(body.fileName || "file.bin");
  const key = `${body.category ?? "common"}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const signature = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt, "put");
  const uploadBaseUrl = getUploadBaseUrl(c.env, c.req.url);

  return c.json({
    success: true,
    data: {
      key,
      expiresAt,
      signature,
      contentType: body.contentType ?? "application/octet-stream",
      uploadUrl: buildSignedObjectUrl(key, expiresAt, signature, uploadBaseUrl),
      fileUrl: buildObjectUrl(key, uploadBaseUrl)
    }
  });
});

uploadRoutes.post("/sign-download", authMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) {
    return c.json(
      {
        success: false,
        error: { message: "缺少 key" }
      },
      400
    );
  }

  if (key.startsWith(DOC_LIBRARY_PREFIX)) {
    return c.json({ success: false, error: { message: "请从资料库打开这个文件" } }, 403);
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const signature = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt, "get");

  return c.json({
    success: true,
    data: {
      url: buildSignedObjectUrl(key, expiresAt, signature, getUploadBaseUrl(c.env, c.req.url))
    }
  });
});

uploadRoutes.put("/object/:key{.+}", async (c) => {
  const rawKey = c.req.param("key");
  const expires = Number(c.req.query("expires") ?? "0");
  const signature = c.req.query("signature") ?? "";

  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return c.json(
      {
        success: false,
        error: { message: "Invalid upload key" }
      },
      400
    );
  }

  if (!key || !expires || !signature || Number.isNaN(expires)) {
    return c.json(
      {
        success: false,
        error: { message: "Invalid upload signature params" }
      },
      400
    );
  }

  if (Date.now() > expires) {
    return c.json(
      {
        success: false,
        error: { message: "Upload URL expired" }
      },
      401
    );
  }

  const signatureValid = await isObjectAccessSignatureValid(
    c.env.UPLOAD_SIGNING_SECRET,
    key,
    expires,
    signature,
    "put"
  );
  if (!signatureValid) {
    return c.json(
      {
        success: false,
        error: { message: "Invalid upload signature" }
      },
      401
    );
  }

  const body = await c.req.arrayBuffer();
  const contentType = c.req.header("content-type") ?? "application/octet-stream";

  await c.env.FILES.put(key, body, {
    httpMetadata: {
      contentType
    }
  });

  return c.json({
    success: true,
    data: {
      key,
      url: buildObjectUrl(key, getUploadBaseUrl(c.env, c.req.url))
    }
  });
});

uploadRoutes.get("/object/:key{.+}", async (c) => {
  const rawKey = c.req.param("key");
  let key = rawKey;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    return c.json(
      {
        success: false,
        error: { message: "Invalid file key" }
      },
      400
    );
  }

  // 受保护的前缀要鉴权，其余前缀行为不变：
  // - contract-draft/：AI 生成合同文书；legacy/fin/：历史财务附件；
  // - doc-library/、wh-task/、wh-doc/：库房的资料、任务照片、库房单照片。
  // 三种方式任一放行：下载签名 / x-api-key（计算节点）/ 登录态。智能体令牌读不了库房这三类。
  const warehouseFile = WAREHOUSE_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (PROTECTED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    const expires = Number(c.req.query("expires") ?? 0);
    const signature = c.req.query("signature") ?? "";
    // expires 为毫秒时间戳，与 POST /sign、PUT /object 既有口径一致
    let allowed = await isObjectAccessSignatureValid(
      c.env.UPLOAD_SIGNING_SECRET,
      key,
      expires,
      signature,
      "get"
    );
    if (!allowed) {
      const apiKey = c.req.header("x-api-key");
      if (apiKey && apiKey === c.env.TASK_API_KEY) allowed = true;
    }
    if (!allowed) {
      const authz = c.req.header("authorization") ?? "";
      const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
      if (token) {
        try {
          const payload = await verify(token, c.env.JWT_SECRET, "HS256");
          allowed = !(warehouseFile && payload.auth_method === "mcp_agent");
        } catch {
          allowed = false;
        }
      }
    }
    if (!allowed) {
      return c.json(
        {
          success: false,
          error: { message: "该文件需要授权访问" }
        },
        401
      );
    }
  }

  return serveObject(c.env, key, c.req.raw, {
    hardened: warehouseFile,
    // 下载时显示的文件名（资料库取地址时带上）；只影响名字，不在签名里
    fileName: warehouseFile ? c.req.query("filename") || undefined : undefined
  });
});
