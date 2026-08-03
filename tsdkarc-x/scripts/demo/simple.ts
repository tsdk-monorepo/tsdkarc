import { z } from "zod";
import { defineModule } from "tsdkarc";
import type { ContextOf } from "tsdkarc";
import {
  defineMiddleware,
  defineRouter,
  MiddlewareEnv,
  MiddlewareExt,
  MiddlewareNextMeta,
  RpcError,
} from "../../src";
import type { Request } from "express";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DI Modules (real dependencies)
// ─────────────────────────────────────────────────────────────────────────────

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUserByToken: async (token: string) => ({
    id: "u_1",
    orgId: "org_1",
    role: "admin" as const,
    mfaEnabled: true,
  }),
  findOrgPlan: async (orgId: string) => ({ tier: "pro" as const }),
}));

export const rateLimitModule = defineModule({ name: "rateLimit" }).init(() => {
  const hits = new Map<string, number[]>();
  return {
    /** Returns true if `key` has made more than `max` calls in the last `windowMs`. */
    isRateLimited: (key: string, max: number, windowMs: number) => {
      const now = Date.now();
      const timestamps = (hits.get(key) ?? []).filter(
        (t) => now - t < windowMs
      );
      timestamps.push(now);
      hits.set(key, timestamps);
      return timestamps.length > max;
    },
  };
});

export const auditModule = defineModule({ name: "audit" }).init(() => ({
  log: async (event: string, data: Record<string, unknown>) => {
    console.log(`[audit] ${event}`, data);
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Context vs Meta
// ─────────────────────────────────────────────────────────────────────────────

export const createContext = async (req: Request) => ({
  get token() {
    return req.header("Authorization")?.replace("Bearer ", "") ?? null;
  },
  get ip() {
    return req.header("x-forwarded-for") ?? req.socket.remoteAddress ?? null;
  },
});

export type AppCtx = ContextOf<typeof dbModule> &
  ContextOf<typeof rateLimitModule> &
  ContextOf<typeof auditModule>;

export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Global middlewares — run on EVERY route, so keep them cheap and universal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a trace ID to every request for log correlation.
 * Adds: { traceId: string }
 */
const tracingMw = defineMiddleware<AppCtx, {}>()(
  async ({ waitUntil }, next) => {
    const traceId = `req_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    return next({ traceId });
  }
);

/**
 * Verifies the bearer token and attaches the calling user.
 * Throws UNAUTHORIZED if the token is missing or invalid.
 * Adds: { user: { id, orgId, role, mfaEnabled } }
 */
const authMw = defineMiddleware<AppCtx, RequestMeta>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token) {
      throw new RpcError("UNAUTHORIZED", "Missing Bearer token");
    }
    const user = await ctx.db.findUserByToken(meta.token);
    if (!user) {
      throw new RpcError("UNAUTHORIZED", "Invalid token");
    }
    return next({ user });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Route-level middlewares — derive TInMeta from upstream middlewares
//    via MiddlewareExt / MiddlewareNextMeta instead of retyping by hand.
//    If authMw's `user` shape or tracingMw's `traceId` ever changes, these
//    requirements update automatically instead of silently drifting.
// ─────────────────────────────────────────────────────────────────────────────

/** What authMw itself contributes: { user: {...} } — not token/ip, just the addition. */
type AuthExt = MiddlewareExt<typeof authMw>;

/** What tracingMw itself contributes: { traceId: string }. */
type TracingExt = MiddlewareExt<typeof tracingMw>;

/**
 * Restricts a route to org admins.
 * Requires: full meta after authMw (token, ip, user) — uses
 * MiddlewareNextMeta since it reads meta.user in context of the whole chain.
 */
const requireAdminMw = defineMiddleware<AppCtx, AuthExt>()(
  async ({ meta }, next) => {
    if (meta.user.role !== "admin") {
      throw new RpcError("FORBIDDEN", "Admin role required");
    }
    return next({});
  }
);

/**
 * Requires MFA to be enabled before allowing a sensitive mutation.
 * Requires: just what authMw adds (AuthExt) — doesn't care about token/ip.
 * Adds: { mfaVerified: true }
 */
const requireMfaMw = defineMiddleware<AppCtx, AuthExt>()(
  async ({ meta }, next) => {
    if (!meta.user.mfaEnabled) {
      throw new RpcError("FORBIDDEN", "MFA must be enabled for this action");
    }
    return next({ mfaVerified: true as const });
  }
);

/**
 * Rate-limits an expensive route per-user. Requires just AuthExt — only
 * needs meta.user, doesn't care what else is in the chain.
 */
const rateLimitMw = defineMiddleware<AppCtx, AuthExt>()(
  async ({ ctx, meta }, next) => {
    if (ctx.rateLimit.isRateLimited(meta.user.id, 5, 60_000)) {
      throw new RpcError(
        "FORBIDDEN",
        "Rate limit exceeded, try again in a minute"
      );
    }
    return next({});
  }
);

/**
 * Fires an audit log entry in the background after a sensitive mutation
 * completes its own middleware chain. Uses waitUntil so the response
 * isn't delayed by the audit write.
 * Requires: AuthExt & TracingExt — composed from the two middlewares that
 * actually produce `user` and `traceId`, instead of a hand-written literal.
 */
const auditMw = defineMiddleware<AppCtx, AuthExt & TracingExt>()(
  async ({ ctx, meta, waitUntil }, next) => {
    waitUntil(
      ctx.audit.log("sensitive_action", {
        userId: meta.user.id,
        traceId: meta.traceId,
      })
    );
    return next({});
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4b. MiddlewareEnv — the same type defineMiddleware curries internally.
// Exported for cases where you want to type a plain function directly
// (e.g. a middleware factory, or a test double) without going through
// defineMiddleware's inference.
// ─────────────────────────────────────────────────────────────────────────────

/** Equivalent to authMw's own env type, written out via the exported helper. */
type AuthMwEnv = MiddlewareEnv<AppCtx, RequestMeta>;

const authMwAlternateForm = async (
  { ctx, meta }: AuthMwEnv,
  next: (ext: {
    user: Awaited<ReturnType<AppCtx["db"]["findUserByToken"]>>;
  }) => Promise<any>
) => {
  if (!meta.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer token");
  const user = await ctx.db.findUserByToken(meta.token);
  return next({ user });
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Router — global concerns in `middlewares`, route-specific via `.use()`
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = defineRouter({
  modules: [dbModule, rateLimitModule, auditModule],
  middlewares: [tracingMw, authMw], // every route: traceId + auth
}).init((r) => ({
  // Plain authenticated route — no extra middleware needed.
  me: r.query(async (_input, env) => env.meta.user),

  // Admin-only route.
  listOrgMembers: r
    .use(requireAdminMw)
    .query(async (_input, env) => [{ id: env.meta.user.id }]),

  // Sensitive mutation: requires MFA, then audits the action in the background.
  deleteAccount: r
    .use(requireMfaMw)
    .use(auditMw)
    .mutate(z.object({ confirm: z.literal(true) }), async (_input, env) => {
      // env.meta has: token, ip, user, traceId, mfaVerified — all typed.
      return "ok";
    }),

  // Expensive route: rate-limited per-user, not globally.
  generateReport: r
    .use(rateLimitMw)
    .mutate(z.object({ month: z.string() }), async (input, env) => {
      return {
        reportUrl: `/reports/${env.meta.user.orgId}/${input.month}.pdf`,
      };
    }),
}));
