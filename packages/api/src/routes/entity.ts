import { Hono } from "hono";

import type { Env } from "../types/env";

export const entityRoutes = new Hono<{ Bindings: Env }>();

entityRoutes.get("/", (c) => c.json({ module: "entity", ready: true }));
