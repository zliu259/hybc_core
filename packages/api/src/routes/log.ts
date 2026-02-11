import { Hono } from "hono";

import type { Env } from "../types/env";

export const logRoutes = new Hono<{ Bindings: Env }>();

logRoutes.get("/", (c) => c.json({ module: "log", ready: true }));
