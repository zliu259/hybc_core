import { Hono } from "hono";

import type { Env } from "../types/env";

export const projectRoutes = new Hono<{ Bindings: Env }>();

projectRoutes.get("/", (c) => c.json({ module: "project", ready: true }));
