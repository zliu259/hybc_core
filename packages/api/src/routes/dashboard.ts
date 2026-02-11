import { Hono } from "hono";

import type { Env } from "../types/env";

export const dashboardRoutes = new Hono<{ Bindings: Env }>();

dashboardRoutes.get("/", (c) => c.json({ module: "dashboard", ready: true }));
