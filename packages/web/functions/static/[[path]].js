// /static/* 资源缺失时 Pages 会返回 SPA 回退页（text/html，且带上 _headers 的
// /static/* 长缓存头），部署传播窗口内曾被边缘缓存导致 chunk 中毒白屏（见
// doc/开发记录.md 2026-08-02）。这里只拦 /static/*：真资源原样放行（保留长缓存），
// 冒充资源的回退页改写为不可缓存的 404，使其永远进不了任何一层缓存。
export const onRequest = async context => {
  const response = await context.env.ASSETS.fetch(context.request);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
  return response;
};
