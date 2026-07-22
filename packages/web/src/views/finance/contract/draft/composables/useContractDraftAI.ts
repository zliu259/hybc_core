import { shallowRef } from "vue";
import type { ContractDraftSection } from "@/api/contract-draft";

export interface SectionAiState {
  phase: "idle" | "generating" | "reviewing" | "done" | "error";
  error: string;
}

interface Deps {
  generate?: (
    draftId: number,
    sectionId: number,
    instruction?: string
  ) => Promise<number>;
  review?: (draftId: number, sectionId: number) => Promise<number>;
  getSection?: (
    draftId: number,
    sectionId: number
  ) => Promise<ContractDraftSection>;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const IDLE: SectionAiState = { phase: "idle", error: "" };

async function defaultGenerate(
  draftId: number,
  sectionId: number,
  instruction?: string
) {
  const { generateSection } = await import("@/api/contract-draft");
  return generateSection(draftId, sectionId, instruction);
}
async function defaultReview(draftId: number, sectionId: number) {
  const { reviewSection } = await import("@/api/contract-draft");
  return reviewSection(draftId, sectionId);
}
async function defaultGetSection(draftId: number, sectionId: number) {
  const { getSection } = await import("@/api/contract-draft");
  return getSection(draftId, sectionId);
}

export function useContractDraftAI(deps: Deps = {}) {
  const generate = deps.generate ?? defaultGenerate;
  const review = deps.review ?? defaultReview;
  const getSection = deps.getSection ?? defaultGetSection;
  const sleep = deps.sleep ?? realSleep;
  const intervalMs = deps.intervalMs ?? 2000;
  const maxPolls = deps.maxPolls ?? 150;

  const states = shallowRef<Map<number, SectionAiState>>(new Map());

  const setState = (sectionId: number, state: SectionAiState) => {
    states.value = new Map(states.value).set(sectionId, state);
  };
  const stateOf = (sectionId: number): SectionAiState =>
    states.value.get(sectionId) ?? IDLE;

  async function pollUntil(
    draftId: number,
    sectionId: number,
    field: "ai_status" | "review_status"
  ): Promise<ContractDraftSection | null> {
    for (let i = 0; i < maxPolls; i++) {
      const section = await getSection(draftId, sectionId);
      if (section[field] === "done") {
        setState(sectionId, { phase: "done", error: "" });
        return section;
      }
      if (section[field] === "error") {
        setState(sectionId, { phase: "error", error: "AI 处理失败，请重试" });
        return null;
      }
      await sleep(intervalMs);
    }
    setState(sectionId, { phase: "error", error: "AI 处理超时，请重试" });
    return null;
  }

  async function generateForSection(
    draftId: number,
    sectionId: number,
    instruction?: string
  ): Promise<ContractDraftSection | null> {
    setState(sectionId, { phase: "generating", error: "" });
    try {
      await generate(draftId, sectionId, instruction);
      return await pollUntil(draftId, sectionId, "ai_status");
    } catch (e: unknown) {
      setState(sectionId, {
        phase: "error",
        error: e instanceof Error ? e.message : "网络异常，请重试"
      });
      return null;
    }
  }

  async function reviewForSection(
    draftId: number,
    sectionId: number
  ): Promise<ContractDraftSection | null> {
    setState(sectionId, { phase: "reviewing", error: "" });
    try {
      await review(draftId, sectionId);
      return await pollUntil(draftId, sectionId, "review_status");
    } catch (e: unknown) {
      setState(sectionId, {
        phase: "error",
        error: e instanceof Error ? e.message : "网络异常，请重试"
      });
      return null;
    }
  }

  return { states, stateOf, generateForSection, reviewForSection };
}
