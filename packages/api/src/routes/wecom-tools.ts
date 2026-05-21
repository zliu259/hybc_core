import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import {
  getConfiguredWeComToolToken,
  getWeComFrontendConfig,
  saveWeComGroupWebhook,
  saveWeComToolToken
} from "../services/wecom-config";
import {
  listWeComGroupChats,
  syncExternalWeComGroupChats,
  upsertWeComGroupChat
} from "../services/wecom-group-chat-directory";
import { sendProjectWeComBindingTestMessage } from "../services/wecom-message-push";
import { callWeComProjectTool } from "../services/wecom-project-tools";
import {
  createProjectWeComBinding,
  disableProjectWeComBinding,
  listProjectWeComPushEvents,
  listProjectWeComBindings,
  listWeComToolCallAudits,
  updateProjectWeComBinding,
  resolveBindingForToolCall
} from "../services/wecom-tool-binding";
import { writeWeComToolAudit } from "../services/wecom-tool-audit";
import type { Env } from "../types/env";
import {
  isWeComReadOnlyToolName,
  weComReadOnlyToolNames,
  weComToolDefinitions,
  type WeComGroupChatType,
  type WeComToolCallContext
} from "../types/wecom-tools";

export const wecomToolRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const tokenFromRequest = (request: Request): string | null => {
  const explicit = request.headers.get("x-wecom-tool-token")?.trim();
  if (explicit) return explicit;

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
};

const requireToolToken = async (env: Env, request: Request): Promise<string | null> => {
  const configured = (await getConfiguredWeComToolToken(env)).token;
  if (!configured) return null;
  const provided = tokenFromRequest(request);
  return provided === configured ? null : "Invalid or missing WeCom tool token";
};

const readBody = async (
  request: Request
): Promise<{
  tool?: unknown;
  input?: unknown;
  context?: unknown;
}> => {
  try {
    return (await request.json()) as {
      tool?: unknown;
      input?: unknown;
      context?: unknown;
    };
  } catch {
    return {};
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const asToolContext = (value: unknown): WeComToolCallContext => {
  const record = asRecord(value);
  return {
    bot_id: typeof record.bot_id === "string" ? record.bot_id : undefined,
    group_chat_id: typeof record.group_chat_id === "string" ? record.group_chat_id : undefined,
    caller_userid: typeof record.caller_userid === "string" ? record.caller_userid : undefined
  };
};

const asGroupChatType = (value: unknown): WeComGroupChatType | undefined => {
  if (
    value === "internal" ||
    value === "external_customer_group" ||
    value === "discovered" ||
    value === "manual"
  ) {
    return value;
  }
  return undefined;
};

wecomToolRoutes.get("/tools/health", (c) => {
  return c.json({ success: true, data: { status: "ok" } });
});

wecomToolRoutes.get("/tools/manifest", (c) => {
  return c.json({
    success: true,
    data: {
      tools: weComReadOnlyToolNames.map((name) => weComToolDefinitions[name])
    }
  });
});

const apiBaseUrlFromRequest = (request: Request): string => {
  const url = new URL(request.url);
  return `${url.origin}/api/v1/wecom`;
};

wecomToolRoutes.get("/config", authMiddleware, requireRoles(["super_admin"]), async (c) => {
  const data = await getWeComFrontendConfig(c.env, apiBaseUrlFromRequest(c.req.raw));
  return c.json({ success: true, data });
});

wecomToolRoutes.put(
  "/config/tool-token",
  authMiddleware,
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    try {
      const data = await saveWeComToolToken(c.env, body.token);
      return c.json({ success: true, data });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "WeCom token save failed" }
        },
        400
      );
    }
  }
);

wecomToolRoutes.put("/webhooks", authMiddleware, requireRoles(["super_admin"]), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    secret_ref?: unknown;
    webhook_url?: unknown;
  };
  try {
    const data = await saveWeComGroupWebhook(c.env, body);
    return c.json({ success: true, data });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: { message: error instanceof Error ? error.message : "WeCom webhook save failed" }
      },
      400
    );
  }
});

wecomToolRoutes.get("/chats", authMiddleware, requireRoles(["super_admin"]), async (c) => {
  const data = await listWeComGroupChats(c.env, {
    keyword: c.req.query("keyword"),
    includeInactive: c.req.query("includeInactive") === "true",
    limit: Number(c.req.query("limit") ?? 100)
  });
  return c.json({ success: true, data });
});

wecomToolRoutes.post("/chats/manual", authMiddleware, requireRoles(["super_admin"]), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    chat_id?: unknown;
    chat_name?: unknown;
    chat_type?: unknown;
    owner_userid?: unknown;
    webhook_secret_ref?: unknown;
  };

  try {
    const data = await upsertWeComGroupChat(c.env, {
      chat_id: typeof body.chat_id === "string" ? body.chat_id : "",
      chat_name: typeof body.chat_name === "string" ? body.chat_name : "",
      chat_type: asGroupChatType(body.chat_type),
      owner_userid: typeof body.owner_userid === "string" ? body.owner_userid : null,
      source: "manual",
      webhook_secret_ref:
        typeof body.webhook_secret_ref === "string" ? body.webhook_secret_ref : null
    });
    return c.json({ success: true, data }, 201);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "WeCom group chat save failed"
        }
      },
      400
    );
  }
});

wecomToolRoutes.post(
  "/chats/sync-external",
  authMiddleware,
  requireRoles(["super_admin"]),
  async (c) => {
    try {
      const data = await syncExternalWeComGroupChats(c.env);
      return c.json({ success: true, data });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: {
            message:
              error instanceof Error ? error.message : "WeCom external group chat sync failed"
          }
        },
        400
      );
    }
  }
);

wecomToolRoutes.get(
  "/projects/:projectId/bindings",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const data = await listProjectWeComBindings(c.env, Number(c.req.param("projectId")));
    return c.json({ success: true, data });
  }
);

wecomToolRoutes.post(
  "/projects/:projectId/bindings",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const projectId = Number(c.req.param("projectId"));
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as {
      binding_name?: string;
      group_chat_id?: string | null;
      bot_id?: string | null;
      allowed_tools?: unknown[];
      push_webhook_secret_ref?: string | null;
      push_enabled?: boolean;
      qa_enabled?: boolean;
    };

    const binding = await createProjectWeComBinding(
      c.env,
      {
        project_id: projectId,
        binding_name: body.binding_name ?? "",
        group_chat_id: body.group_chat_id ?? null,
        bot_id: body.bot_id ?? null,
        allowed_tools: body.allowed_tools,
        push_webhook_secret_ref: body.push_webhook_secret_ref ?? null,
        push_enabled: body.push_enabled,
        qa_enabled: body.qa_enabled
      },
      auth.sub
    );

    return c.json({ success: true, data: binding }, 201);
  }
);

wecomToolRoutes.put(
  "/projects/:projectId/bindings/:bindingId",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const projectId = Number(c.req.param("projectId"));
    const bindingId = Number(c.req.param("bindingId"));
    const body = (await c.req.json().catch(() => ({}))) as {
      binding_name?: string;
      group_chat_id?: string | null;
      bot_id?: string | null;
      allowed_tools?: unknown[];
      push_webhook_secret_ref?: string | null;
      push_enabled?: boolean;
      qa_enabled?: boolean;
    };

    try {
      const binding = await updateProjectWeComBinding(c.env, bindingId, {
        project_id: projectId,
        binding_name: body.binding_name ?? "",
        group_chat_id: body.group_chat_id ?? null,
        bot_id: body.bot_id ?? null,
        allowed_tools: body.allowed_tools,
        push_webhook_secret_ref: body.push_webhook_secret_ref ?? null,
        push_enabled: body.push_enabled,
        qa_enabled: body.qa_enabled
      });

      return c.json({ success: true, data: binding });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "WeCom binding update failed" }
        },
        400
      );
    }
  }
);

wecomToolRoutes.post(
  "/projects/:projectId/bindings/:bindingId/test",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    try {
      await sendProjectWeComBindingTestMessage(c.env, Number(c.req.param("bindingId")), {
        projectId: Number(c.req.param("projectId"))
      });
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { message: error instanceof Error ? error.message : "WeCom test push failed" }
        },
        400
      );
    }
  }
);

wecomToolRoutes.get(
  "/projects/:projectId/tool-audits",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const data = await listWeComToolCallAudits(
      c.env,
      Number(c.req.param("projectId")),
      Number(c.req.query("limit") ?? 20)
    );
    return c.json({ success: true, data });
  }
);

wecomToolRoutes.get(
  "/projects/:projectId/push-events",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    const data = await listProjectWeComPushEvents(
      c.env,
      Number(c.req.param("projectId")),
      Number(c.req.query("limit") ?? 20)
    );
    return c.json({ success: true, data });
  }
);

wecomToolRoutes.delete(
  "/projects/:projectId/bindings/:bindingId",
  authMiddleware,
  requireRoles(["super_admin", "manager", "site_manager"]),
  async (c) => {
    await disableProjectWeComBinding(c.env, Number(c.req.param("bindingId")));
    return c.json({ success: true });
  }
);

wecomToolRoutes.post("/tools/call", async (c) => {
  const tokenError = await requireToolToken(c.env, c.req.raw);
  if (tokenError) {
    return c.json({ success: false, error: { message: tokenError } }, 401);
  }

  const startedAt = Date.now();
  const body = await readBody(c.req.raw);
  if (!isWeComReadOnlyToolName(body.tool)) {
    return c.json({ success: false, error: { message: "Unsupported WeCom tool" } }, 400);
  }

  const input = asRecord(body.input);
  const context = asToolContext(body.context);
  let binding = null;

  try {
    binding = await resolveBindingForToolCall(c.env, {
      tool: body.tool,
      context
    });
    const result = await callWeComProjectTool(c.env, body.tool, input);
    await writeWeComToolAudit(c.env, {
      binding,
      tool_name: body.tool,
      context,
      request: body,
      response: result.data,
      status: "success",
      latency_ms: Date.now() - startedAt
    });

    return c.json({
      success: true,
      data: result.data,
      meta: result.meta
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WeCom tool call failed";
    const forbidden = message.includes("not allowed") || message.includes("binding not found");

    if (binding) {
      await writeWeComToolAudit(c.env, {
        binding,
        tool_name: body.tool,
        context,
        request: body,
        status: forbidden ? "forbidden" : "failed",
        error_message: message,
        latency_ms: Date.now() - startedAt
      });
    }

    return c.json(
      {
        success: false,
        error: { message }
      },
      forbidden ? 403 : 500
    );
  }
});
