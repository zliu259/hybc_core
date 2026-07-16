const BOOT_CODE_RE = /^[0-9a-f-]{36}$/i;
const AGENTS = new Set(["claude_code", "codex", "claude_desktop"]);

export const safeBoot = (raw: string): string => (BOOT_CODE_RE.test(raw) ? raw : "");
export const safeAgent = (raw: string): string => (AGENTS.has(raw) ? raw : "other");

export interface RenderInput {
  apiBase: string;
  boot: string;
  agent: string;
}

/**
 * 把从 R2 取来的安装脚本模板里的 __HYBC_*__ 占位替换为校验过的值。
 * boot 必须是 UUID 形态(否则空串,杜绝 shell 注入);agent 必须白名单。
 */
export const renderInstallScript = (template: string, input: RenderInput): string =>
  template
    .replaceAll("__HYBC_API__", input.apiBase.replace(/\/+$/, ""))
    .replaceAll("__HYBC_BOOT__", safeBoot(input.boot))
    .replaceAll("__HYBC_AGENT__", safeAgent(input.agent));
