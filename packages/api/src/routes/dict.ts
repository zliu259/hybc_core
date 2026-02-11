import { Hono } from "hono";

import type { Env } from "../types/env";

export const dictRoutes = new Hono<{ Bindings: Env }>();

dictRoutes.get("/", (c) => c.json({ module: "dict", ready: true }));
