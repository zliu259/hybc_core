/**
 * 把 API / 附件地址归一到当前 API 基址（`VITE_API_BASE_URL`）。
 *
 * 背景：后端签发的上传、下载、对象直连地址都是以 `WECOM_PUSH_API_BASE_URL`（`https://api.hybcdg.com`）
 * 拼出来的绝对地址，而且已经随业务单据落库。网页端 API 基址切到东京入口（`api-relay.hybcdg.com`）后，
 * 这些地址若原样使用就会绕开新入口、继续走 Cloudflare 边缘。本模块在渲染处把它们的 origin
 * 换成当前基址，存量数据不需要回填。
 *
 * 规则：
 * - 空值原样返回；
 * - 相对路径：基址非空时拼接，否则原样（本地开发走 Vite 代理）；
 * - 绝对地址且 origin 在 {@link LEGACY_API_ORIGINS} 里：基址非空时替换 origin，保留 path/query/hash；
 * - 其余绝对地址（第三方域、`blob:`、`data:`、前缀相似的伪域名）一律原样。
 */
export const LEGACY_API_ORIGINS: readonly string[] = ["https://api.hybcdg.com"];

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

/** 当前构建的 API 基址（去尾斜杠），空串表示同源相对路径。 */
export const getApiBaseUrl = (): string =>
  stripTrailingSlash(import.meta.env.VITE_API_BASE_URL || "");

const hasScheme = (url: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(url);

export const normalizeApiUrl = (
  url: string,
  base: string = getApiBaseUrl()
): string => {
  if (!url) return url;
  const normalizedBase = stripTrailingSlash(base);

  if (!hasScheme(url)) {
    if (!normalizedBase) return url;
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${normalizedBase}${path}`;
  }

  if (!normalizedBase) return url;
  if (!/^https?:/i.test(url)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!LEGACY_API_ORIGINS.includes(parsed.origin)) return url;
  return `${normalizedBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
};
