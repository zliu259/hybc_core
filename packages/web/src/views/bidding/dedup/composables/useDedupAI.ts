import { ref, shallowRef } from "vue";
import type { RewriteParagraph } from "../lib/rewrite";
import type { RewriteResultResponse } from "@/api/bidding-dedup";

export type { RewriteResultResponse };

interface Deps {
  request?: (paragraphs: RewriteParagraph[]) => Promise<number>;
  poll?: (taskId: number) => Promise<RewriteResultResponse>;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Lazily import HTTP functions so the test environment can inject mocks
// without triggering the store/router chain that the http client depends on.
async function defaultRequest(paragraphs: RewriteParagraph[]): Promise<number> {
  const { requestRewrite } = await import("@/api/bidding-dedup");
  return requestRewrite(paragraphs);
}

async function defaultPoll(taskId: number): Promise<RewriteResultResponse> {
  const { pollRewrite } = await import("@/api/bidding-dedup");
  return pollRewrite(taskId);
}

export function useDedupAI(deps: Deps = {}) {
  const request = deps.request ?? defaultRequest;
  const poll = deps.poll ?? defaultPoll;
  const sleep = deps.sleep ?? realSleep;
  const intervalMs = deps.intervalMs ?? 2000;
  const maxPolls = deps.maxPolls ?? 150;

  const status = ref<RewriteResultResponse["status"] | "idle">("idle");
  const error = ref<string>("");
  const rewrites = shallowRef<Map<string, string>>(new Map());
  const accepted = shallowRef<Map<string, string>>(new Map());

  async function start(paragraphs: RewriteParagraph[]): Promise<void> {
    status.value = "pending";
    error.value = "";
    rewrites.value = new Map();
    accepted.value = new Map();
    const taskId = await request(paragraphs);
    for (let i = 0; i < maxPolls; i++) {
      const res = await poll(taskId);
      status.value = res.status;
      if (res.status === "completed") {
        rewrites.value = new Map((res.rewrites ?? []).map((r) => [r.id, r.text]));
        return;
      }
      if (res.status === "failed" || res.status === "timeout") {
        error.value = res.error ?? "AI 去重失败";
        return;
      }
      await sleep(intervalMs);
    }
    status.value = "timeout";
    error.value = "AI 去重超时，请重试";
  }

  function accept(id: string): void {
    const text = rewrites.value.get(id);
    if (text === undefined) return;
    accepted.value = new Map(accepted.value).set(id, text);
  }

  function skip(id: string): void {
    const next = new Map(accepted.value);
    next.delete(id);
    accepted.value = next;
  }

  function acceptAll(): void {
    accepted.value = new Map(rewrites.value);
  }

  return { status, error, rewrites, accepted, start, accept, skip, acceptAll };
}
