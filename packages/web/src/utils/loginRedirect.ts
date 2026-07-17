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
