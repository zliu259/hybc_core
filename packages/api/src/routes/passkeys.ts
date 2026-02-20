import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { createSessionPayload, issueTokens, toFrontendLoginResponse } from "../services/auth";
import {
  consumePasskeyChallenge,
  getPasskeyFeatureConfig,
  issuePasskeyChallenge,
  writePasskeyAuditLog
} from "../services/passkey";
import type { Env } from "../types/env";

type RegistrationBeginBody = {
  name?: string;
};

type RegistrationFinishBody = {
  challengeId?: string;
  credentialId?: string;
  publicKey?: string;
  counter?: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
};

type AuthenticationBeginBody = {
  userId?: string;
};

type AuthenticationFinishBody = {
  challengeId?: string;
  userId?: string;
  credentialId?: string;
  counter?: number;
};

type DbPasskeyCredential = {
  id: number;
  user_id: string;
  credential_id: string;
  counter: number;
  name: string | null;
  transports_json: string | null;
  created_at: string;
  last_used_at: string | null;
  wecom_verified_at: string;
  status: string;
};

const unauthorizedResponse = (message: string, code = 401) => {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message
      }
    }),
    {
      status: code,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

const badRequest = (message: string) => {
  return {
    success: false,
    error: {
      message
    }
  };
};

const getRequestMeta = (c: {
  req: { header: (key: string) => string | undefined };
}) => {
  return {
    ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for"),
    userAgent: c.req.header("user-agent")
  };
};

const ensureFeatureEnabled = async (c: { env: Env }) => {
  const config = await getPasskeyFeatureConfig(c.env);
  return config.enabled && config.rolloutMode === "all";
};

export const passkeyRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

passkeyRoutes.use("/register/*", authMiddleware);
passkeyRoutes.use("/credentials/*", authMiddleware);

passkeyRoutes.post("/register/begin", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as RegistrationBeginBody;
  const { challengeId, challenge } = await issuePasskeyChallenge(
    c.env,
    "register",
    auth.sub
  );

  const existing = await c.env.DB.prepare(
    `SELECT credential_id FROM passkey_credentials
     WHERE user_id = ? AND status = 'active'
     ORDER BY id DESC`
  )
    .bind(auth.sub)
    .all<{ credential_id: string }>();

  return c.json({
    success: true,
    data: {
      challengeId,
      options: {
        challenge,
        rp: {
          id: c.env.PASSKEY_RP_ID,
          name: c.env.PASSKEY_RP_NAME
        },
        user: {
          id: auth.sub,
          name: auth.username,
          displayName: auth.nickname
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        timeout: 60000,
        attestation: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred"
        },
        excludeCredentials: existing.results.map((item) => ({
          id: item.credential_id,
          type: "public-key"
        })),
        extensions: {
          credProps: true
        }
      },
      credentialName: body.name?.trim() || null
    }
  });
});

passkeyRoutes.post("/register/finish", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => ({}))) as RegistrationFinishBody;
  const { ip, userAgent } = getRequestMeta(c);

  if (!body.challengeId || !body.credentialId || !body.publicKey) {
    return c.json(badRequest("Missing challengeId/credentialId/publicKey"), 400);
  }

  const challenge = await consumePasskeyChallenge(
    c.env,
    body.challengeId,
    "register",
    auth.sub
  );
  if (!challenge) {
    await writePasskeyAuditLog(c.env, {
      userId: auth.sub,
      credentialId: body.credentialId,
      action: "register_finish",
      success: false,
      detail: { reason: "challenge_invalid_or_expired" },
      ip,
      userAgent
    });
    return c.json(badRequest("Challenge invalid or expired"), 400);
  }

  const now = new Date().toISOString();
  const publicKeyBytes = new TextEncoder().encode(body.publicKey);

  await c.env.DB.prepare(
    `INSERT INTO passkey_credentials (
      user_id,
      credential_id,
      public_key,
      counter,
      transports_json,
      device_type,
      backed_up,
      name,
      wecom_verified_at,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(
      auth.sub,
      body.credentialId,
      publicKeyBytes,
      body.counter ?? 0,
      body.transports ? JSON.stringify(body.transports) : null,
      body.deviceType ?? null,
      body.backedUp ? 1 : 0,
      null,
      now,
      now,
      now
    )
    .run();

  await writePasskeyAuditLog(c.env, {
    userId: auth.sub,
    credentialId: body.credentialId,
    action: "register_finish",
    success: true,
    detail: { challengeCreatedAt: challenge.createdAt },
    ip,
    userAgent
  });

  return c.json({
    success: true,
    data: {
      credentialId: body.credentialId,
      userId: auth.sub,
      createdAt: now
    }
  });
});

passkeyRoutes.post("/auth/begin", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as AuthenticationBeginBody;
  const userId = body.userId?.trim();
  if (!userId) {
    return c.json(badRequest("Missing userId"), 400);
  }

  const credentials = await c.env.DB.prepare(
    `SELECT credential_id FROM passkey_credentials
     WHERE user_id = ? AND status = 'active'
     ORDER BY id DESC`
  )
    .bind(userId)
    .all<{ credential_id: string }>();

  if (!credentials.results.length) {
    return c.json(badRequest("No passkey credential enrolled for this user"), 404);
  }

  const { challengeId, challenge } = await issuePasskeyChallenge(
    c.env,
    "authenticate",
    userId
  );

  return c.json({
    success: true,
    data: {
      challengeId,
      options: {
        challenge,
        timeout: 60000,
        rpId: c.env.PASSKEY_RP_ID,
        userVerification: "preferred",
        allowCredentials: credentials.results.map((item) => ({
          id: item.credential_id,
          type: "public-key"
        }))
      }
    }
  });
});

passkeyRoutes.post("/auth/finish", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as AuthenticationFinishBody;
  const { ip, userAgent } = getRequestMeta(c);

  if (!body.challengeId || !body.userId || !body.credentialId) {
    return c.json(badRequest("Missing challengeId/userId/credentialId"), 400);
  }

  const challenge = await consumePasskeyChallenge(
    c.env,
    body.challengeId,
    "authenticate",
    body.userId
  );
  if (!challenge) {
    await writePasskeyAuditLog(c.env, {
      userId: body.userId,
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: { reason: "challenge_invalid_or_expired" },
      ip,
      userAgent
    });
    return c.json(badRequest("Challenge invalid or expired"), 400);
  }

  const credential = await c.env.DB.prepare(
    `SELECT id, user_id, credential_id, counter, name, transports_json, created_at, last_used_at, wecom_verified_at, status
     FROM passkey_credentials
     WHERE user_id = ? AND credential_id = ? AND status = 'active'
     LIMIT 1`
  )
    .bind(body.userId, body.credentialId)
    .first<DbPasskeyCredential>();

  if (!credential) {
    await writePasskeyAuditLog(c.env, {
      userId: body.userId,
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: { reason: "credential_not_found" },
      ip,
      userAgent
    });
    return c.json(badRequest("Credential not found"), 404);
  }

  const nextCounter = body.counter ?? credential.counter + 1;
  if (nextCounter <= credential.counter) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE passkey_credentials
       SET status = 'revoked', revoked_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, credential.id)
      .run();

    await writePasskeyAuditLog(c.env, {
      userId: body.userId,
      credentialId: body.credentialId,
      action: "auth_finish",
      success: false,
      detail: {
        reason: "counter_regression",
        previousCounter: credential.counter,
        providedCounter: nextCounter
      },
      ip,
      userAgent
    });

    return c.json(badRequest("Invalid credential counter"), 401);
  }

  const usedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE passkey_credentials
     SET counter = ?, last_used_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(nextCounter, usedAt, usedAt, credential.id)
    .run();

  const session = createSessionPayload(
    {
      userId: credential.user_id,
      username: credential.user_id,
      nickname: credential.user_id
    },
    {
      authMethod: "passkey",
      wecomVerifiedAt: credential.wecom_verified_at
    }
  );
  const tokenBundle = await issueTokens(c.env, session);

  await writePasskeyAuditLog(c.env, {
    userId: body.userId,
    credentialId: body.credentialId,
    action: "auth_finish",
    success: true,
    detail: { challengeCreatedAt: challenge.createdAt, usedAt },
    ip,
    userAgent
  });

  return c.json(toFrontendLoginResponse(tokenBundle));
});

passkeyRoutes.get("/credentials", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const rows = await c.env.DB.prepare(
    `SELECT credential_id, counter, name, transports_json, created_at, last_used_at, status
     FROM passkey_credentials
     WHERE user_id = ?
     ORDER BY id DESC`
  )
    .bind(auth.sub)
    .all<DbPasskeyCredential>();

  return c.json({
    success: true,
    data: rows.results.map((item) => ({
      credentialId: item.credential_id,
      counter: item.counter,
      name: item.name,
      transports: item.transports_json ? (JSON.parse(item.transports_json) as string[]) : [],
      createdAt: item.created_at,
      lastUsedAt: item.last_used_at,
      status: item.status
    }))
  });
});

passkeyRoutes.delete("/credentials/:credentialId", async (c) => {
  if (!(await ensureFeatureEnabled(c))) {
    return c.json(badRequest("Passkey feature is disabled"), 403);
  }

  const auth = c.get("auth");
  const credentialId = c.req.param("credentialId").trim();
  if (!credentialId) {
    return c.json(badRequest("Missing credentialId"), 400);
  }

  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE passkey_credentials
     SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE user_id = ? AND credential_id = ? AND status = 'active'`
  )
    .bind(now, now, auth.sub, credentialId)
    .run();

  const changed = (result.meta.changes ?? 0) > 0;

  await writePasskeyAuditLog(c.env, {
    userId: auth.sub,
    credentialId,
    action: "credential_revoke",
    success: changed,
    detail: { changed },
    ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for"),
    userAgent: c.req.header("user-agent")
  });

  if (!changed) {
    return c.json(badRequest("Credential not found"), 404);
  }

  return c.json({
    success: true,
    data: {
      credentialId,
      revokedAt: now
    }
  });
});

passkeyRoutes.onError(() => {
  return unauthorizedResponse("Passkey route error", 500);
});
