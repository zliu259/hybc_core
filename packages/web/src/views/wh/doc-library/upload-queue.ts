/** 多个文件排队上传：同时最多传两个，一个失败不影响别的，失败的可以单独重试。不碰界面，接口从外面传进来。 */
import type {
  CompleteDocUploadInput,
  DocMetaInput
} from "@/api/wh/doc-library-types";
import { resolveApiErrorMessage } from "@/utils/api-error";

import {
  uploadFileInParts,
  type UploadDeps,
  type UploadedFile
} from "./doc-upload";

export type UploadStatus = "waiting" | "uploading" | "done" | "failed";
export type UploadMeta = DocMetaInput & { supersedes_id?: number };

export interface UploadItemInput {
  /** 调用方给的唯一标识 */
  key: string;
  file: Blob;
  name: string;
  meta: UploadMeta;
}
export interface UploadItemState {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  /** 已经传完的字节数 */
  sentBytes: number;
  /** 失败原因，没失败是空串 */
  error: string;
  /** 传完后资料的 id */
  docId: number | null;
}
export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  waiting: number;
  uploading: number;
}

export interface QueueDeps extends Pick<
  UploadDeps,
  "init" | "putPart" | "abort" | "retries" | "retryDelayMs"
> {
  complete: (input: CompleteDocUploadInput) => Promise<{ id: number }>;
  /** 同时传几个文件，默认 2 */
  concurrency?: number;
  onChange?: (items: UploadItemState[]) => void;
}

export interface DocUploadQueue {
  add: (inputs: readonly UploadItemInput[]) => void;
  /** 开始传排队的；返回的 Promise 在没有排队和在传的时候完成 */
  start: () => Promise<void>;
  retry: (key: string) => Promise<void>;
  /** 排队的直接拿掉；正在传的放弃后拿掉；已经在写记录或已传完的不动 */
  cancel: (key: string) => void;
  cancelAll: () => void;
  clearFinished: () => void;
  items: () => UploadItemState[];
  summary: () => UploadSummary;
}

interface Job {
  input: UploadItemInput;
  /** 分片都传上去了、还没写成记录时留着：完成请求超时后重试不用重传 */
  uploaded: UploadedFile | null;
  controller: AbortController | null;
  /** 正在发完成请求：这时候不能取消，记录可能已经写成了 */
  completing: boolean;
}

const DEFAULT_CONCURRENCY = 2;
const OFFLINE = "网络不通或超时，点重试再试一次";

const statusOf = (error: unknown): number | null => {
  const status = (error as { response?: { status?: unknown } } | null)?.response
    ?.status;
  return typeof status === "number" ? status : null;
};

/** 没拿到回应、或者服务端临时出错：结果不确定，分片留着，重试只重发完成请求。 */
const isTransient = (error: unknown): boolean => {
  const status = statusOf(error);
  return status === null || status >= 500 || status === 408 || status === 429;
};

export const createDocUploadQueue = (deps: QueueDeps): DocUploadQueue => {
  const limit = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  let states: UploadItemState[] = [];
  let jobs: ReadonlyMap<string, Job> = new Map();
  let active = 0;
  let idleWaiters: (() => void)[] = [];

  const emit = () => deps.onChange?.(states);
  const patch = (key: string, change: Partial<UploadItemState>) => {
    states = states.map(state =>
      state.key === key ? { ...state, ...change } : state
    );
    emit();
  };
  const setJob = (key: string, change: Partial<Job>) => {
    const job = jobs.get(key);
    if (job) jobs = new Map(jobs).set(key, { ...job, ...change });
  };
  const remove = (key: string) => {
    states = states.filter(state => state.key !== key);
    jobs = new Map([...jobs].filter(([jobKey]) => jobKey !== key));
    emit();
  };

  const settle = () => {
    if (active > 0 || states.some(state => state.status === "waiting")) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach(resolve => resolve());
  };

  const sendParts = (key: string, job: Job, signal: AbortSignal) => {
    patch(key, { sentBytes: 0 });
    return uploadFileInParts(
      job.input.file,
      job.input.name,
      {
        init: deps.init,
        putPart: deps.putPart,
        abort: deps.abort,
        retries: deps.retries,
        retryDelayMs: deps.retryDelayMs,
        signal
      },
      sentBytes => patch(key, { sentBytes })
    );
  };

  const run = async (key: string): Promise<void> => {
    const job = jobs.get(key);
    if (!job) return;
    const controller = new AbortController();
    setJob(key, { controller });
    patch(key, { status: "uploading", error: "" });
    try {
      const uploaded =
        job.uploaded ?? (await sendParts(key, job, controller.signal));
      if (!jobs.has(key)) return;
      setJob(key, { uploaded, completing: true });
      const result = await deps.complete({
        ...job.input.meta,
        upload_token: uploaded.upload_token,
        parts: uploaded.parts
      });
      patch(key, {
        status: "done",
        sentBytes: job.input.file.size,
        docId: result.id
      });
    } catch (error) {
      // 取消的已经从清单里拿掉了
      if (!jobs.has(key)) return;
      const completing = jobs.get(key)?.completing ?? false;
      if (completing && !isTransient(error)) setJob(key, { uploaded: null });
      patch(key, {
        status: "failed",
        error:
          completing && statusOf(error) === null
            ? OFFLINE
            : resolveApiErrorMessage(error, "上传失败，请重试")
      });
    } finally {
      setJob(key, { controller: null, completing: false });
    }
  };

  const pump = () => {
    while (active < limit) {
      const next = states.find(state => state.status === "waiting");
      if (!next) break;
      active += 1;
      // run 一开始就同步把状态改成 uploading，下一轮不会再挑到它
      void run(next.key).finally(() => {
        active -= 1;
        pump();
      });
    }
    settle();
  };

  const start = (): Promise<void> => {
    const idle = new Promise<void>(resolve => {
      idleWaiters = [...idleWaiters, resolve];
    });
    pump();
    return idle;
  };

  const cancel = (key: string) => {
    const state = states.find(entry => entry.key === key);
    const job = jobs.get(key);
    if (!state || !job) return;
    if (state.status === "done" || job.completing) return;
    const controller = job.controller;
    remove(key);
    controller?.abort();
    settle();
  };

  return {
    add: inputs => {
      const fresh = inputs.filter(
        (input, index) =>
          !jobs.has(input.key) &&
          inputs.findIndex(other => other.key === input.key) === index
      );
      if (fresh.length === 0) return;
      jobs = new Map([
        ...jobs,
        ...fresh.map(
          input =>
            [
              input.key,
              { input, uploaded: null, controller: null, completing: false }
            ] as const
        )
      ]);
      states = [
        ...states,
        ...fresh.map(input => ({
          key: input.key,
          name: input.name,
          size: input.file.size,
          status: "waiting" as const,
          sentBytes: 0,
          error: "",
          docId: null
        }))
      ];
      emit();
    },
    start,
    retry: key => {
      const state = states.find(entry => entry.key === key);
      if (state?.status !== "failed") return Promise.resolve();
      patch(key, { status: "waiting", error: "" });
      return start();
    },
    cancel,
    cancelAll: () =>
      states
        .filter(state => state.status !== "done")
        .forEach(state => cancel(state.key)),
    clearFinished: () =>
      states
        .filter(state => state.status === "done")
        .forEach(state => remove(state.key)),
    items: () => states,
    summary: () => ({
      total: states.length,
      done: states.filter(state => state.status === "done").length,
      failed: states.filter(state => state.status === "failed").length,
      waiting: states.filter(state => state.status === "waiting").length,
      uploading: states.filter(state => state.status === "uploading").length
    })
  };
};
