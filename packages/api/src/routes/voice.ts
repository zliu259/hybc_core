import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createTask } from "../services/ai-slot";
import type { Env } from "../types/env";

type VoiceSttRequest = {
  file_key: string;
  file_name?: string;
  scene?: string;
  hints?: string[];
};

type CommandParseRequest = {
  text: string;
  scene?: string;
};

type VoiceCommand = {
  intent: string;
  type: "navigate" | "switchTab" | "none";
  route?: string;
  confidence: number;
  message: string;
};

const parseTaskResult = (resultJson: string | null): Record<string, unknown> | null => {
  if (!resultJson) return null;
  try {
    const raw = JSON.parse(resultJson) as { output?: string } & Record<string, unknown>;
    if (typeof raw.output === "string") {
      try {
        return JSON.parse(raw.output) as Record<string, unknown>;
      } catch {
        return { output: raw.output };
      }
    }
    return raw;
  } catch {
    return null;
  }
};

const parseVoiceCommand = (text: string, scene?: string): VoiceCommand => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return {
      intent: "unknown",
      type: "none",
      confidence: 0,
      message: "未识别到有效指令"
    };
  }

  if (normalized.includes("报销")) {
    return {
      intent: "reimbursement_create",
      type: "navigate",
      route: "/pages/reimbursement/index",
      confidence: 0.92,
      message: "已识别为发起报销"
    };
  }

  if (normalized.includes("对外付款") || normalized.includes("付款") || normalized.includes("打款")) {
    return {
      intent: "payment_apply",
      type: "navigate",
      route: "/pages/payment-apply/index",
      confidence: 0.9,
      message: "已识别为发起对外付款"
    };
  }

  if (normalized.includes("审批") || normalized.includes("待办")) {
    return {
      intent: "approval_pending",
      type: "navigate",
      route: "/pages/approval/index",
      confidence: 0.88,
      message: "已识别为进入审批待办"
    };
  }

  if (normalized.includes("现场") || normalized.includes("勘查")) {
    return {
      intent: "site_survey",
      type: "navigate",
      route: "/pages/survey/index",
      confidence: 0.86,
      message: "已识别为进入现场勘查"
    };
  }

  if (normalized.includes("设备") || normalized.includes("资产")) {
    return {
      intent: "asset_check",
      type: "navigate",
      route: "/pages/asset/index",
      confidence: 0.85,
      message: "已识别为进入设备查验"
    };
  }

  if (normalized.includes("施工日志") || normalized.includes("顶进")) {
    return {
      intent: "operator_log",
      type: "navigate",
      route: "/pages/operator-log/index",
      confidence: 0.84,
      message: "已识别为填报施工日志"
    };
  }

  if (normalized.includes("管理日志") || normalized.includes("现场概况")) {
    return {
      intent: "manager_log",
      type: "navigate",
      route: "/pages/manager-log/index",
      confidence: 0.84,
      message: "已识别为填写管理日志"
    };
  }

  if (normalized.includes("工作台") || normalized.includes("首页")) {
    return {
      intent: "tab_workbench",
      type: "switchTab",
      route: "/pages/index/index",
      confidence: 0.82,
      message: "已识别为返回工作台"
    };
  }

  if (normalized.includes("流程") || normalized.includes("财务")) {
    return {
      intent: "tab_finance",
      type: "switchTab",
      route: "/pages/finance/index",
      confidence: 0.8,
      message: "已识别为进入流程页"
    };
  }

  if (normalized.includes("我的")) {
    return {
      intent: "tab_profile",
      type: "switchTab",
      route: "/pages/profile/index",
      confidence: 0.78,
      message: "已识别为进入我的页面"
    };
  }

  if (normalized.includes("现场中心") || normalized.includes("现场页")) {
    return {
      intent: "tab_warehouse",
      type: "switchTab",
      route: "/pages/warehouse/index",
      confidence: 0.78,
      message: "已识别为进入现场页"
    };
  }

  return {
    intent: `unknown_${scene ?? "default"}`,
    type: "none",
    confidence: 0.2,
    message: "暂未匹配到标准指令，请重试更明确的表述"
  };
};

export const voiceRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

voiceRoutes.use("*", authMiddleware);

voiceRoutes.post("/stt", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json()) as VoiceSttRequest;

  if (!body.file_key?.trim()) {
    return c.json({ success: false, error: { message: "file_key is required" } }, 400);
  }

  const task = await createTask(c.env, {
    task_type: "voice_stt",
    biz_type: "miniapp_voice",
    biz_id: 0,
    priority: 5,
    payload: {
      file_key: body.file_key,
      file_name: body.file_name ?? null,
      scene: body.scene ?? null,
      hints: body.hints ?? [],
      requester: auth.sub
    },
    timeout_seconds: 180
  });

  return c.json({
    success: true,
    data: {
      task_id: task.id,
      status: "pending",
      message: "语音识别任务已创建"
    }
  }, 201);
});

voiceRoutes.get("/stt/:taskId", async (c) => {
  const taskId = Number(c.req.param("taskId"));
  if (!taskId || Number.isNaN(taskId)) {
    return c.json({ success: false, error: { message: "invalid taskId" } }, 400);
  }

  const task = await c.env.DB.prepare(
    "SELECT id, status, result_json, error_message, task_type, biz_type FROM task_queue WHERE id = ?"
  )
    .bind(taskId)
    .first<{
      id: number;
      status: string;
      result_json: string | null;
      error_message: string | null;
      task_type: string;
      biz_type: string;
    }>();

  if (!task || task.task_type !== "voice_stt" || task.biz_type !== "miniapp_voice") {
    return c.json({ success: false, error: { message: "voice stt task not found" } }, 404);
  }

  const result = parseTaskResult(task.result_json);
  const transcript =
    typeof result?.transcript === "string"
      ? result.transcript
      : typeof result?.text === "string"
        ? result.text
        : typeof result?.output === "string"
          ? result.output
          : "";

  const confidence =
    typeof result?.confidence === "number"
      ? result.confidence
      : typeof result?.score === "number"
        ? result.score
        : null;

  return c.json({
    success: true,
    data: {
      task_id: task.id,
      status: task.status,
      transcript,
      confidence,
      error_message: task.error_message,
      pending_hint:
        task.status === "pending" || task.status === "assigned" || task.status === "running"
          ? "识别处理中，请稍后轮询"
          : null
    }
  });
});

voiceRoutes.post("/command-parse", async (c) => {
  const body = (await c.req.json()) as CommandParseRequest;
  const text = body.text?.trim();

  if (!text) {
    return c.json({ success: false, error: { message: "text is required" } }, 400);
  }

  const command = parseVoiceCommand(text, body.scene);
  return c.json({
    success: true,
    data: {
      input: text,
      scene: body.scene ?? null,
      command
    }
  });
});
