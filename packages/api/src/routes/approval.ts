import { Hono } from "hono";

import type { Env } from "../types/env";

export const approvalRoutes = new Hono<{ Bindings: Env }>();

approvalRoutes.get("/", (c) => c.json({ module: "approval", ready: true }));
