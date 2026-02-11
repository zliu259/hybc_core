import { Hono } from "hono";

import type { Env } from "../types/env";

export const paymentRoutes = new Hono<{ Bindings: Env }>();

paymentRoutes.get("/", (c) => c.json({ module: "payment", ready: true }));
