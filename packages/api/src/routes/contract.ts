import { Hono } from "hono";

import type { Env } from "../types/env";

export const contractRoutes = new Hono<{ Bindings: Env }>();

contractRoutes.get("/", (c) => c.json({ module: "contract", ready: true }));
