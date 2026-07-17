import { createAgentGrant } from "./agent-grant";
import type { UserRole } from "../types/auth";
import type { DeviceCodeRecord, DeviceStatus } from "../types/agent";

const DEVICE_TTL_SECONDS = 600;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混字符

const deviceKey = (code: string) => `agent:device:${code}`;
const userCodeKey = (code: string) => `agent:usercode:${code}`;
const bootKey = (code: string) => `agent:boot:${code}`;

const randomFrom = (alphabet: string, length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const makeUserCode = (): string =>
  `${randomFrom(USER_CODE_ALPHABET, 4)}-${randomFrom(USER_CODE_ALPHABET, 4)}`;

export interface StartDeviceInput {
  webBaseUrl: string;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
}

export interface StartDeviceResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export const startDeviceAuthorization = async (
  kv: KVNamespace,
  input: StartDeviceInput
): Promise<StartDeviceResult> => {
  if (!input.webBaseUrl) {
    throw new Error("webBaseUrl required");
  }
  const deviceCode = crypto.randomUUID();
  const userCode = makeUserCode();
  const nowIso = new Date().toISOString();
  const record: DeviceCodeRecord = {
    userCode,
    status: "pending",
    agentType: input.agentType,
    deviceName: input.deviceName,
    clientInfo: input.clientInfo,
    expiresAt: new Date(Date.now() + DEVICE_TTL_SECONDS * 1000).toISOString(),
    createdAt: nowIso
  };
  await kv.put(deviceKey(deviceCode), JSON.stringify(record), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
  await kv.put(userCodeKey(userCode), deviceCode, {
    expirationTtl: DEVICE_TTL_SECONDS
  });

  const base = input.webBaseUrl.replace(/\/$/, "");
  const verificationUri = `${base}/agent/authorize`;
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: DEVICE_TTL_SECONDS,
    interval: 5
  };
};

export const approveDeviceByUserCode = async (
  kv: KVNamespace,
  db: D1Database,
  userCode: string,
  approver: { wecomUserid: string; role: UserRole }
): Promise<void> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) throw new Error("Unknown or expired user_code");
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) throw new Error("Unknown or expired user_code");
  const record = JSON.parse(raw) as DeviceCodeRecord;
  if (record.status !== "pending") throw new Error("Device request already resolved");

  const { token } = await createAgentGrant(db, {
    wecomUserid: approver.wecomUserid,
    role: approver.role,
    deviceName: record.deviceName,
    clientInfo: record.clientInfo,
    agentType: record.agentType
  });

  const updated: DeviceCodeRecord = {
    ...record,
    status: "approved",
    wecomUserid: approver.wecomUserid,
    role: approver.role,
    agentToken: token
  };
  await kv.put(deviceKey(deviceCode), JSON.stringify(updated), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
};

export type PollResult =
  | { status: "authorization_pending" }
  | { status: "expired" }
  | { status: "denied" }
  | {
      status: "granted";
      agent_token: string;
      wecom_userid: string;
      role: UserRole;
    };

export const pollDeviceToken = async (
  kv: KVNamespace,
  _db: D1Database,
  deviceCode: string
): Promise<PollResult> => {
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) return { status: "expired" };
  let record: DeviceCodeRecord;
  try {
    record = JSON.parse(raw) as DeviceCodeRecord;
  } catch (err) {
    console.error("agent device record parse failed", err);
    return { status: "expired" };
  }
  if (record.status === "pending") return { status: "authorization_pending" };
  if (record.status === "denied") return { status: "denied" };
  if (record.status === "approved" && record.agentToken && record.wecomUserid) {
    // 一次性发放：领取后删除
    await kv.delete(deviceKey(deviceCode));
    await kv.delete(userCodeKey(record.userCode));
    return {
      status: "granted",
      agent_token: record.agentToken,
      wecom_userid: record.wecomUserid,
      role: record.role ?? ("operator" as UserRole)
    };
  }
  return { status: "expired" };
};

export interface DeviceInfoView {
  user_code: string;
  device_name: string | null;
  agent_type: string | null;
  client_info: string | null;
  status: DeviceStatus;
}

// 授权页展示用：按 user_code 查设备元数据（不含 token 等敏感字段）
export const getDeviceInfoByUserCode = async (
  kv: KVNamespace,
  userCode: string
): Promise<DeviceInfoView | null> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) return null;
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) return null;
  let record: DeviceCodeRecord;
  try {
    record = JSON.parse(raw) as DeviceCodeRecord;
  } catch (err) {
    console.error("agent device record parse failed", err);
    return null;
  }
  return {
    user_code: userCode,
    device_name: record.deviceName ?? null,
    agent_type: record.agentType ?? null,
    client_info: record.clientInfo ?? null,
    status: record.status
  };
};

// 授权页「拒绝」：仅 pending 可拒绝，已批准/已拒绝的请求不可重复处置
export const denyDeviceByUserCode = async (kv: KVNamespace, userCode: string): Promise<void> => {
  const deviceCode = await kv.get(userCodeKey(userCode));
  if (!deviceCode) throw new Error("Unknown or expired user_code");
  const raw = await kv.get(deviceKey(deviceCode));
  if (!raw) throw new Error("Unknown or expired user_code");
  let record: DeviceCodeRecord;
  try {
    record = JSON.parse(raw) as DeviceCodeRecord;
  } catch (err) {
    // 记录损坏时不外泄解析错误详情，对客户端与「记录不存在」同口径
    console.error("agent device record parse failed", err);
    throw new Error("Unknown or expired user_code");
  }
  if (record.status !== "pending") throw new Error("Device request already resolved");
  const updated: DeviceCodeRecord = { ...record, status: "denied" };
  await kv.put(deviceKey(deviceCode), JSON.stringify(updated), {
    expirationTtl: DEVICE_TTL_SECONDS
  });
};

export interface ProvisionInput {
  wecomUserid: string;
  role: UserRole;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
}

export const provisionBootstrapGrant = async (
  kv: KVNamespace,
  db: D1Database,
  input: ProvisionInput
): Promise<{ boot_code: string; expires_in: number }> => {
  const { token } = await createAgentGrant(db, input);
  const bootCode = crypto.randomUUID();
  await kv.put(
    bootKey(bootCode),
    JSON.stringify({ agent_token: token, wecom_userid: input.wecomUserid, role: input.role }),
    { expirationTtl: DEVICE_TTL_SECONDS }
  );
  return { boot_code: bootCode, expires_in: DEVICE_TTL_SECONDS };
};

export const redeemBootstrap = async (
  kv: KVNamespace,
  bootCode: string
): Promise<{ agent_token: string; wecom_userid: string; role: UserRole } | null> => {
  const raw = await kv.get(bootKey(bootCode));
  if (!raw) return null;
  await kv.delete(bootKey(bootCode));
  return JSON.parse(raw) as { agent_token: string; wecom_userid: string; role: UserRole };
};
