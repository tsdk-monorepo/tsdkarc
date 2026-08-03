import { z } from "zod";
import { defineModule } from "tsdkarc";
import { defineMiddleware, defineRouter } from "../../src/server";
import { Request } from "express";
import { ContextOf } from "tsdkarc";
import { DeepFlat, MiddlewareExt, MiddlewareNextMeta } from "../../src/types";

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
  deleteUser: (id: string) => true,
}));

export const emailModule = defineModule({ name: "email" }).init(() => ({
  sendBackgroundAlert: async (msg: string) => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`[Email Service] Sent: ${msg}`);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Context vs Meta
//
// AppCtx     = DI-resolved services. Constant for the lifetime of the app.
//              Same object every middleware and every route handler sees.
// RequestMeta = Per-request data. Seeded from createContext(req) as the
//              initial `meta`, then grown by each middleware via next(ext).
// ─────────────────────────────────────────────────────────────────────────────

export const createContext = async (c: Request) => ({
  get token() {
    return c.header("Authorization") || null;
  },
  get ip() {
    return c.header("x-forwarded-for") || null;
  },
});

export type AppCtx = DeepFlat<
  ContextOf<typeof dbModule> & ContextOf<typeof emailModule>
>;

export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

/**
 * Verifies the bearer token and resolves the calling user.
 * Adds: { user: { id: string, role: string } }
 */
export const authMw = defineMiddleware<AppCtx, RequestMeta>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token) {
      // throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
    }
    // Real DI access — ctx.findUser comes from dbModule, not from meta.
    const user = ctx.db.findUser("u_1");
    return next({ user: { id: user.id, role: user.role } });
  }
);

/**
 * Route-level MFA check. Requires `user` to already be in meta,
 * so it must run after authMw in the chain.
 * Adds: { mfaPassed: boolean }
 */
export const verifyMfaMw = defineMiddleware<
  AppCtx,
  MiddlewareNextMeta<typeof authMw>
>()(async ({ meta, ctx }, next) => {
  return next({ mfaPassed: meta.user.role === "admin" });
});

export const verifyMfaMwWithTypeError = defineMiddleware<
  AppCtx,
  MiddlewareNextMeta<typeof authMw> & { extraField: number }
>()(async ({ meta, ctx }, next) => {
  return next({ mfaPassed: meta.user.role === "admin" });
});

/**
 * Logs the request and fires a background alert email without blocking
 * the response, using ctx.sendBackgroundAlert + waitUntil.
 * Adds: { traceId: string }
 */
export const loggerMw = defineMiddleware<
  AppCtx,
  MiddlewareNextMeta<typeof authMw>
>()(async ({ ctx, meta, waitUntil }, next) => {
  console.log(`[Access Log] Request from IP: ${meta.ip}`);
  waitUntil(
    ctx.email.sendBackgroundAlert(`Request from ${meta.ip ?? "unknown"}`)
  );
  return next({ traceId: `req_${Date.now()}` });
});

export const appRouter = defineRouter({
  modules: [dbModule, emailModule],
  middlewares: [authMw, loggerMw],
});
