/**
 * 智能发单台幂等 key 派生。
 *
 * 一轮发单只铸造一个 run id（页面挂载时生成，每次提交成功后轮换），
 * 该轮里所有请求的 key 都由「run id + 该步骤内容指纹」派生：
 * - 失败后原样重试：内容未变，key 相同，服务端直接重放已创建的记录，不会再建一份；
 * - 改了内容再提交：指纹变化，key 变化，按新记录处理；
 * - 提交成功：run id 轮换，下一次提交是一笔全新的业务动作。
 */
export type SubmitAttemptKeys = {
  fingerprint: string;
  createKey: string;
  submitKey: string;
};

export const createWizardRunId = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** FNV-1a 32 位哈希，base36 输出：短、稳定、可放进请求头。 */
export const hashFingerprint = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
};

export const buildSubmitAttemptKeys = (
  scope: string,
  runId: string,
  fingerprint: string
): SubmitAttemptKeys => {
  const digest = hashFingerprint(fingerprint);
  return {
    fingerprint,
    createKey: `${scope}-create-${runId}-${digest}`,
    submitKey: `${scope}-submit-${runId}-${digest}`
  };
};
