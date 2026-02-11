import { Hono } from "hono";

import type { Env } from "../types/env";

export const systemRoutes = new Hono<{ Bindings: Env }>();

systemRoutes.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "api",
    env: c.env.APP_ENV,
    now: new Date().toISOString()
  });
});

systemRoutes.get("/storage-check", async (c) => {
  const marker = `ping-${Date.now()}`;
  const key = `health/${marker}.txt`;

  await c.env.DB.prepare(
    "INSERT INTO sys_health (name, created_at) VALUES (?1, ?2)"
  )
    .bind(marker, new Date().toISOString())
    .run();

  await c.env.FILES.put(key, marker, {
    httpMetadata: { contentType: "text/plain" }
  });

  const file = await c.env.FILES.get(key);
  const value = file ? await file.text() : null;

  return c.json({
    ok: true,
    d1Inserted: marker,
    r2Key: key,
    r2Value: value
  });
});
