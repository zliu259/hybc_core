import { Hono } from "hono";

import { corsMiddleware } from "./middleware/cors";
import { handleError } from "./middleware/error";
import { requestLoggerMiddleware } from "./middleware/logger";
import { adminRoutes } from "./routes/admin";
import { approvalRoutes } from "./routes/approval";
import { assetRoutes } from "./routes/asset";
import { authRoutes } from "./routes/auth";
import { contractRoutes } from "./routes/contract";
import { dashboardRoutes } from "./routes/dashboard";
import { dictRoutes } from "./routes/dict";
import { entityRoutes } from "./routes/entity";
import { logRoutes } from "./routes/log";
import { paymentRoutes } from "./routes/payment";
import { projectRoutes } from "./routes/project";
import { receiptRoutes } from "./routes/receipt";
import { reimbursementRoutes } from "./routes/reimbursement";
import { systemRoutes } from "./routes/system";
import { surveyRoutes } from "./routes/survey";
import { taskRoutes } from "./routes/task";
import { uploadRoutes } from "./routes/upload";
import { userRoutes } from "./routes/user";
import { warehouseRoutes } from "./routes/warehouse";
import type { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);
app.use("*", requestLoggerMiddleware);
app.onError(handleError);

app.get("/", (c) => {
  return c.json({
    name: "hybc-api",
    message: "Worker is running",
    docs: "/api/v1/system/health"
  });
});

app.route("/api/v1/system", systemRoutes);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/entity", entityRoutes);
app.route("/api/v1/project", projectRoutes);
app.route("/api/v1/contract", contractRoutes);
app.route("/api/v1/payment", paymentRoutes);
app.route("/api/v1/reimbursement", reimbursementRoutes);
app.route("/api/v1/receipt", receiptRoutes);
app.route("/api/v1/log", logRoutes);
app.route("/api/v1/survey", surveyRoutes);
app.route("/api/v1/approval", approvalRoutes);
app.route("/api/v1/asset", assetRoutes);
app.route("/api/v1/warehouse", warehouseRoutes);
app.route("/api/v1/task", taskRoutes);
app.route("/api/v1/dict", dictRoutes);
app.route("/api/v1/upload", uploadRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/dashboard", dashboardRoutes);

export default app;
