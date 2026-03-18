import { getConfig } from "@/config";

export type RelayNodeConfig = {
  id: string;
  baseUrl: string;
  priority: number;
  enabled: boolean;
  statusPath: string;
  supportsWriteFallback: boolean;
  probeTimeoutMs: number;
};

export type RelayProbeResult = {
  node: RelayNodeConfig;
  eligible: boolean;
  loadScore: number;
  reason: string;
};

const DEFAULT_STATUS_PATH = "/relay/status";
const DEFAULT_PROBE_TIMEOUT_MS = 1200;
const DEFAULT_MAX_ATTEMPTS = 2;
const RELAY_COOLDOWN_STORE_MS = 20_000;
const relayCooldown = new Map<string, number>();

const normalizeBaseUrl = (value: string): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
};

const isWriteMethod = (method?: string): boolean => {
  const m = (method || "GET").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
};

const now = () => Date.now();

const cleanupCooldown = () => {
  const current = now();
  for (const [key, expiry] of relayCooldown.entries()) {
    if (expiry <= current) {
      relayCooldown.delete(key);
    }
  }
};

const inCooldown = (baseUrl: string): boolean => {
  cleanupCooldown();
  const expiry = relayCooldown.get(baseUrl);
  return typeof expiry === "number" && expiry > now();
};

const parseRelayConfig = (): RelayNodeConfig[] => {
  const raw = getConfig("ApiRelayPool");
  if (!raw || typeof raw !== "object") return [];
  const source = raw as { enabled?: boolean; nodes?: unknown[] };
  if (source.enabled === false || !Array.isArray(source.nodes)) return [];

  const nodes: RelayNodeConfig[] = [];
  for (let index = 0; index < source.nodes.length; index += 1) {
    const item = source.nodes[index];
    if (!item || typeof item !== "object") continue;
    const relay = item as {
      id?: string;
      baseUrl?: string;
      priority?: number;
      enabled?: boolean;
      statusPath?: string;
      supportsWriteFallback?: boolean;
      probeTimeoutMs?: number;
    };
    const baseUrl = normalizeBaseUrl(relay.baseUrl || "");
    if (!baseUrl) continue;
    nodes.push({
      id: relay.id || `relay-${index + 1}`,
      baseUrl,
      priority: Number.isFinite(relay.priority) ? Number(relay.priority) : 100,
      enabled: relay.enabled !== false,
      statusPath: relay.statusPath || DEFAULT_STATUS_PATH,
      supportsWriteFallback: relay.supportsWriteFallback === true,
      probeTimeoutMs: Number.isFinite(relay.probeTimeoutMs)
        ? Math.max(200, Number(relay.probeTimeoutMs))
        : DEFAULT_PROBE_TIMEOUT_MS
    });
  }

  return nodes;
};

const supportsWriteFallback = (
  method: string | undefined,
  headers: Record<string, unknown> | undefined
): boolean => {
  if (!isWriteMethod(method)) return true;
  if (!headers) return false;
  const keys = Object.keys(headers);
  return keys.some(k => k.toLowerCase() === "idempotency-key");
};

const fetchRelayStatus = async (
  node: RelayNodeConfig
): Promise<RelayProbeResult> => {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    node.probeTimeoutMs
  );
  const endpoint = `${node.baseUrl}${node.statusPath.startsWith("/") ? node.statusPath : `/${node.statusPath}`}`;

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      return {
        node,
        eligible: false,
        loadScore: Number.POSITIVE_INFINITY,
        reason: `status_${response.status}`
      };
    }
    const data = (await response.json()) as {
      overloaded?: boolean;
      inflight_requests?: number;
      max_inflight?: number;
      cooldown_seconds_left?: number;
      admission_state?: string;
    };
    if (data.overloaded === true) {
      return {
        node,
        eligible: false,
        loadScore: Number.POSITIVE_INFINITY,
        reason: "overloaded"
      };
    }
    if (
      typeof data.cooldown_seconds_left === "number" &&
      data.cooldown_seconds_left > 0
    ) {
      return {
        node,
        eligible: false,
        loadScore: Number.POSITIVE_INFINITY,
        reason: "cooldown"
      };
    }
    if (
      typeof data.admission_state === "string" &&
      data.admission_state !== "accepting"
    ) {
      return {
        node,
        eligible: false,
        loadScore: Number.POSITIVE_INFINITY,
        reason: "admission_blocked"
      };
    }
    const inflight =
      typeof data.inflight_requests === "number" ? data.inflight_requests : 0;
    const maxInflight =
      typeof data.max_inflight === "number" && data.max_inflight > 0
        ? data.max_inflight
        : 1;
    const loadScore = inflight / maxInflight;
    return { node, eligible: true, loadScore, reason: "ok" };
  } catch {
    return {
      node,
      eligible: false,
      loadScore: Number.POSITIVE_INFINITY,
      reason: "probe_failed"
    };
  } finally {
    window.clearTimeout(timer);
  }
};

export const getRelayCandidates = async (
  method: string | undefined,
  headers: Record<string, unknown> | undefined,
  currentBaseURL: string | undefined
): Promise<RelayNodeConfig[]> => {
  const nodes = parseRelayConfig();
  if (nodes.length === 0) return [];
  if (!supportsWriteFallback(method, headers)) return [];

  const current = normalizeBaseUrl(currentBaseURL || "");
  const methodIsWrite = isWriteMethod(method);
  const enabled = nodes.filter(node => {
    if (!node.enabled) return false;
    if (current && node.baseUrl === current) return false;
    if (inCooldown(node.baseUrl)) return false;
    if (methodIsWrite && !node.supportsWriteFallback) return false;
    return true;
  });
  if (enabled.length === 0) return [];

  const probeResults = await Promise.all(enabled.map(fetchRelayStatus));
  const eligible = probeResults.filter(item => item.eligible);
  if (eligible.length === 0) return [];

  eligible.sort((a, b) => {
    if (a.node.priority !== b.node.priority)
      return a.node.priority - b.node.priority;
    if (a.loadScore !== b.loadScore) return a.loadScore - b.loadScore;
    return a.node.id.localeCompare(b.node.id);
  });

  const grouped: RelayNodeConfig[] = [];
  for (let i = 0; i < eligible.length; i += 1) {
    const currentPriority = eligible[i].node.priority;
    const samePriority = eligible.filter(
      it => it.node.priority === currentPriority
    );
    if (samePriority.length > 1) {
      samePriority.sort((a, b) => a.loadScore - b.loadScore);
      const head = samePriority.slice(0, Math.min(2, samePriority.length));
      const pick = head[Math.floor(Math.random() * head.length)];
      if (!grouped.some(n => n.id === pick.node.id)) {
        grouped.push(pick.node);
      }
      for (const item of samePriority) {
        if (!grouped.some(n => n.id === item.node.id)) {
          grouped.push(item.node);
        }
      }
      i += samePriority.length - 1;
      continue;
    }
    grouped.push(eligible[i].node);
  }

  const rawMaxAttempts = Number(getConfig("ApiRelayPool.maxAttempts"));
  const maxAttempts = Number.isFinite(rawMaxAttempts)
    ? Math.max(1, Math.min(3, rawMaxAttempts))
    : DEFAULT_MAX_ATTEMPTS;
  return grouped.slice(0, maxAttempts);
};

export const markRelayFailure = (
  baseUrl: string,
  ms = RELAY_COOLDOWN_STORE_MS
): void => {
  relayCooldown.set(baseUrl, now() + Math.max(ms, 1000));
};

export const clearRelayCooldown = (baseUrl: string): void => {
  relayCooldown.delete(baseUrl);
};
