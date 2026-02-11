import { Hono } from "hono";

import type { Env } from "../types/env";

export const assetRoutes = new Hono<{ Bindings: Env }>();

assetRoutes.get("/", (c) => c.json({ module: "asset", ready: true }));
