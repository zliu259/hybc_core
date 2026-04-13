import type { Context } from "hono";

export const handleError = (err: Error, c: Context) => {
  const errorDetail = {
    name: err?.name ?? "Unknown",
    message: err?.message ?? "No message",
    path: c.req.path,
    method: c.req.method
  };
  console.error(JSON.stringify(errorDetail), err?.stack ?? "");

  return c.json(
    {
      ok: false,
      error: {
        message: err?.message ?? "Internal Server Error"
      }
    },
    500
  );
};
