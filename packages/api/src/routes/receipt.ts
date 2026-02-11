import { Hono } from "hono";

import type { Env } from "../types/env";

export const receiptRoutes = new Hono<{ Bindings: Env }>();

receiptRoutes.get("/", (c) => c.json({ module: "receipt", ready: true }));
