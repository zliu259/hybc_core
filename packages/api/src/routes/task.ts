import { Hono } from "hono";

import type { Env } from "../types/env";

export const taskRoutes = new Hono<{ Bindings: Env }>();

taskRoutes.get("/", (c) => c.json({ module: "task", ready: true }));
