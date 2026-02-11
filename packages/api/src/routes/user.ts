import { Hono } from "hono";

import type { Env } from "../types/env";

export const userRoutes = new Hono<{ Bindings: Env }>();

userRoutes.get("/", (c) => c.json({ module: "user", ready: true }));
