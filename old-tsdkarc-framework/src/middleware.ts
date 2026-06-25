import type { Middleware } from "./server";

/**
 * Logs request data and response result for every route.
 */
export const logMiddleware: Middleware = async (ctx, data, next) => {
  console.log("[req]", data);
  const result = await next();
  console.log("[res]", result);
  return result;
};

/**
 * Rejects requests missing a token field.
 * Replace with real auth logic (JWT, session, etc).
 */
export const authMiddleware: Middleware = async (ctx, data, next) => {
  if (!ctx.meta().headers.token) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return next();
};
