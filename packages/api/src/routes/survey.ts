import { Hono } from "hono";

import type { Env } from "../types/env";

export const surveyRoutes = new Hono<{ Bindings: Env }>();

surveyRoutes.get("/", (c) => c.json({ module: "survey", ready: true }));
