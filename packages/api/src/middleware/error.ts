import type { Context } from "hono";

export const handleError = (err: Error, c: Context) => {
  console.error(err);

  return c.json(
    {
      ok: false,
      error: {
        message: "Internal Server Error"
      }
    },
    500
  );
};
