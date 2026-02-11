import { Hono } from "hono";

import type { Env } from "../types/env";

export const uploadRoutes = new Hono<{ Bindings: Env }>();

uploadRoutes.get("/", (c) => c.json({ module: "upload", ready: true }));
