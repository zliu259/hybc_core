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
import { fleetRoutes } from "./routes/fleet";
import { logRoutes } from "./routes/log";
import { paymentRoutes } from "./routes/payment";
import { passkeyRoutes } from "./routes/passkeys";
import { projectRoutes } from "./routes/project";
import { publicProjectLogRoutes } from "./routes/public-project-log";
import { receiptRoutes } from "./routes/receipt";
import { reimbursementRoutes } from "./routes/reimbursement";
import { systemRoutes } from "./routes/system";
import { supportRoutes } from "./routes/support";
import { surveyRoutes } from "./routes/survey";
import { taskRoutes } from "./routes/task";
import { uploadRoutes } from "./routes/upload";
import { userRoutes } from "./routes/user";
import { vehicleMaintenanceRoutes } from "./routes/vehicle-maintenance";
import { voiceRoutes } from "./routes/voice";
import { wecomToolRoutes } from "./routes/wecom-tools";
import { warehouseRoutes } from "./routes/warehouse";
import { warehouseManualRoutes } from "./routes/warehouse-manual";
import { warehouseAssetWorkOrderRoutes } from "./routes/warehouse-work-order";
import { queue } from "./queue-handler";
import { scheduled } from "./scheduled";
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

app.get("/WW_verify_sVPd1Q6fW7UMqLN2.txt", (c) => {
  return c.text("sVPd1Q6fW7UMqLN2", 200, {
    "content-type": "text/plain; charset=utf-8"
  });
});

app.route("/api/v1/system", systemRoutes);
app.route("/api/v1/support", supportRoutes);
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/passkeys", passkeyRoutes);
app.route("/api/v1/user", userRoutes);
app.route("/api/v1/entity", entityRoutes);
app.route("/api/v1/fleet/maintenance", vehicleMaintenanceRoutes);
app.route("/api/v1/fleet", fleetRoutes);
app.route("/api/v1/project", projectRoutes);
app.route("/api/v1/public/project-log", publicProjectLogRoutes);
app.route("/api/v1/contract", contractRoutes);
app.route("/api/v1/payment", paymentRoutes);
app.route("/api/v1/reimbursement", reimbursementRoutes);
app.route("/api/v1/receipt", receiptRoutes);
app.route("/api/v1/log", logRoutes);
app.route("/api/v1/survey", surveyRoutes);
app.route("/api/v1/approval", approvalRoutes);
app.route("/api/v1/asset", assetRoutes);
app.route("/api/v1/warehouse/manual", warehouseManualRoutes);
app.route("/api/v1/warehouse/work-order", warehouseAssetWorkOrderRoutes);
app.route("/api/v1/warehouse", warehouseRoutes);
app.route("/api/v1/task", taskRoutes);
app.route("/api/v1/dict", dictRoutes);
app.route("/api/v1/upload", uploadRoutes);
app.route("/api/v1/voice", voiceRoutes);
app.route("/api/v1/wecom", wecomToolRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/dashboard", dashboardRoutes);

export default {
  fetch: app.fetch,
  queue,
  scheduled
};
