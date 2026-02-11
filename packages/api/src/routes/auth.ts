import { Hono } from "hono";

import type { Env } from "../types/env";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/", (c) => c.json({ module: "auth", ready: true }));
