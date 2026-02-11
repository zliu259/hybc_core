import type { MiddlewareHandler } from "hono";

import type { AuthVariables } from "./auth";
import type { UserRole } from "../types/auth";
import type { Env } from "../types/env";

export const requireRoles = (
  acceptedRoles: UserRole[]
): MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> => {
  return async (c, next) => {
    const auth = c.get("auth");
    const allowed = auth.roles.some((role) => acceptedRoles.includes(role));
    if (!allowed) {
      return c.json(
        {
          success: false,
          error: {
            message: "Forbidden"
          }
        },
        403
      );
    }

    await next();
  };
};
