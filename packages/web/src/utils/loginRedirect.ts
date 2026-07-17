const STORAGE_KEY = "hybc-login-redirect";

/**
 * 登录后回跳地址白名单校验：只允许站内相对路径（防开放重定向），
 * 登录页自身不允许（防循环）。非法输入一律返回 null。
 */
export const sanitizeRedirect = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (/[\s\\#]/.test(raw)) return null; // 浏览器解析 URL 会剥离 \t\n\r、把 \ 当 /；hash 应用的站内路径也不该含 #。拒绝以防未来落入 location.href 汇点
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (
    raw === "/login" ||
    raw.startsWith("/login?") ||
    raw.startsWith("/login/")
  ) {
    return null;
  }
  return raw;
};

/** 进入登录页时暂存目标地址（WeCom OAuth 往返会丢 hash，必须落 sessionStorage） */
export const stashRedirect = (raw: unknown): void => {
  const target = sanitizeRedirect(raw);
  if (!target) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, target);
  } catch {
    // sessionStorage 不可用时静默降级为默认首页跳转
  }
};

/** 清除暂存的回跳地址（用户放弃深链、手动进登录页时避免旧目标残留） */
export const clearRedirect = (): void => {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage 不可用时无需清理
  }
};

/**
 * 登录页挂载时的暂存决策：
 * - OAuth 返回趟（带 code）直接返回、绝不动暂存——守卫在该趟会注入默认 redirect
 *   （如 /workspace/home），无条件暂存会覆盖往返前保存的真正深链。
 * - 普通挂载（无 code）：redirect 合法则暂存；否则清除旧暂存，避免用户放弃深链后
 *   手动进 /login 时残留的过期目标把登录后跳转劫持到非预期页面。
 */
export const stashRedirectFromLoginMount = (
  oauthCode: string | null,
  redirect: unknown
): void => {
  if (oauthCode) return;
  if (sanitizeRedirect(redirect)) {
    stashRedirect(redirect);
  } else {
    clearRedirect();
  }
};

/** 登录成功后取出并清除暂存的回跳地址 */
export const popRedirect = (): string | null => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return sanitizeRedirect(raw);
  } catch {
    return null;
  }
};
