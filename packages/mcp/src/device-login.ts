import { HybcApiClient } from "./api-client.js";

export interface DeviceCodeResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "authorization_pending" | "denied" | "expired" }
  | { status: "granted"; agent_token: string; wecom_userid: string; role: string };

export interface LoginOptions {
  baseUrl: string;
  deviceName?: string;
  agentType?: string;
  clientInfo?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  openBrowser?: (url: string) => void;
  log?: (message: string) => void;
}

export interface LoginResult {
  token: string;
  wecomUserid: string;
  role: string;
}

export const runLogin = async (opts: LoginOptions): Promise<LoginResult> => {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => process.stderr.write(`${m}\n`));

  const client = new HybcApiClient(opts.baseUrl, null);
  const start = (
    await client.post<DeviceCodeResult>("/agent/device/code", {
      device_name: opts.deviceName,
      agent_type: opts.agentType,
      client_info: opts.clientInfo
    })
  ).data;

  log(
    `请在浏览器打开并用企业微信登录授权：\n  ${start.verification_uri_complete}\n设备码：${start.user_code}（${Math.round(
      start.expires_in / 60
    )} 分钟内有效）`
  );
  opts.openBrowser?.(start.verification_uri_complete);

  const deadline = now() + start.expires_in * 1000;
  const intervalMs = start.interval * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    const poll = (
      await client.post<PollResult>("/agent/device/token", {
        device_code: start.device_code
      })
    ).data;
    if (poll.status === "granted") {
      return {
        token: poll.agent_token,
        wecomUserid: poll.wecom_userid,
        role: poll.role
      };
    }
    if (poll.status === "denied") throw new Error("授权被拒绝（denied）");
    if (poll.status === "expired") throw new Error("设备码已过期，请重新登录");
    // authorization_pending -> keep polling
  }
  throw new Error("授权超时，请重新登录");
};
