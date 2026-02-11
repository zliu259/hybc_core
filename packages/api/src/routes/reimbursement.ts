import { Hono } from "hono";

import type { Env } from "../types/env";

export const reimbursementRoutes = new Hono<{ Bindings: Env }>();

reimbursementRoutes.get("/", (c) => c.json({ module: "reimbursement", ready: true }));
