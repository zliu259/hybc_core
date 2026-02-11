import { Hono } from "hono";

import type { Env } from "../types/env";

export const warehouseRoutes = new Hono<{ Bindings: Env }>();

warehouseRoutes.get("/", (c) => c.json({ module: "warehouse", ready: true }));
