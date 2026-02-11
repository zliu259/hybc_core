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
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind("system_check", "api", JSON.stringify({ marker }), new Date().toISOString())
    .run();

  await c.env.FILES.put(key, marker, {
    httpMetadata: { contentType: "text/plain" }
  });

  await c.env.KV.put(`health:${marker}`, marker);

  const file = await c.env.FILES.get(key);
  const value = file ? await file.text() : null;
  const kvValue = await c.env.KV.get(`health:${marker}`);

  await c.env.EVENT_QUEUE.send({
    type: "system.storage_check",
    marker,
    at: new Date().toISOString()
  });

  return c.json({
    ok: true,
    d1Inserted: marker,
    r2Key: key,
    r2Value: value,
    kvValue
  });
});
