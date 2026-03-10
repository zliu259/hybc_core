import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import type { Env } from "../types/env";

const toHex = (arrayBuffer: ArrayBuffer): string => {
  const view = new Uint8Array(arrayBuffer);
  return [...view].map((v) => v.toString(16).padStart(2, "0")).join("");
};

const signUpload = async (
  secret: string,
  key: string,
  expiresAt: number
): Promise<string> => {
  const keyData = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    keyData,
    new TextEncoder().encode(`${key}:${expiresAt}`)
  );

  return toHex(signature);
};

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

  const expiresAt = Date.now() + 10 * 60 * 1000;
  const safeName = parseFileName(body.fileName || "file.bin");
  const key = `${body.category ?? "common"}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const signature = await signUpload(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt);

  return c.json({
    success: true,
    data: {
      key,
      expiresAt,
      signature,
      contentType: body.contentType ?? "application/octet-stream",
      uploadUrl: `/api/v1/upload/object/${encodeURIComponent(key)}?expires=${expiresAt}&signature=${signature}`,
      fileUrl: `/api/v1/upload/object/${encodeURIComponent(key)}`
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

  const expectedSignature = await signUpload(c.env.UPLOAD_SIGNING_SECRET, key, expires);
  if (expectedSignature !== signature) {
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
      url: `/api/v1/upload/object/${encodeURIComponent(key)}`
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
