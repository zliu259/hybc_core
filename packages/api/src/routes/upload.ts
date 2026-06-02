import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import {
  buildObjectUrl,
  buildSignedObjectUrl,
  isObjectAccessSignatureValid,
  signObjectAccess
} from "../services/upload-signature";
import type { Env } from "../types/env";

const parseFileName = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
};

const getUploadBaseUrl = (env: Env, requestUrl: string): string => {
  return env.WECOM_PUSH_API_BASE_URL?.trim() || new URL(requestUrl).origin;
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

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const safeName = parseFileName(body.fileName || "file.bin");
  const key = `${body.category ?? "common"}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const signature = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt);
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
    signature
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
  const object = await c.env.FILES.get(key);
  if (!object || !object.body) {
    return c.json(
      {
        success: false,
        error: { message: "File not found" }
      },
      404
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
});
