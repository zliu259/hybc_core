import { Hono } from "hono";

import type { Env } from "../types/env";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.get("/", (c) => c.json({ module: "admin", ready: true }));
