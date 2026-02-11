import { Hono } from "hono";

import { systemRoutes } from "./routes/system";
import type { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({
    name: "hybc-api",
    message: "Worker is running",
    docs: "/api/v1/system/health"
  });
});

app.route("/api/v1/system", systemRoutes);

export default app;
