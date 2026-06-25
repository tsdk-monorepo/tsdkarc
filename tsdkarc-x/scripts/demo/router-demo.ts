import { z } from "zod";
import { defineModule } from "tsdkarc"; // Adjust path to your DI core
import { defineMiddleware, defineRoutes, launchApp } from "../../src/server";
import { RpcError, type RoutesOf } from "../../src/types";
import { HonoAdapter } from "../../src/hono-adapter";
import { ExpressAdapter } from "../../src/express-adapter";
import { apiReference } from "@scalar/express-api-reference";
import { Request } from "express";
import { ContextOf } from "tsdkarc";
import { extractOpenApi } from "../../src/scripts/openapi";

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
// 2. Middlewares & Scoped Context
// ─────────────────────────────────────────────────────────────────────────────

export const createContext = async (c: Request) => ({
  get token() {
    return c.header("Authorization") || null;
  },
  get ip() {
    return c.header("x-forwarded-for") || null;
  },
});

export type BaseCtx = Awaited<ReturnType<typeof createContext>> &
  ContextOf<typeof dbModule> &
  ContextOf<typeof emailModule>;

// 1. Auth Middleware (Auto-infers { user: { id: string, role: string } })
export const authMw = defineMiddleware<BaseCtx>()(async (ctx, next) => {
  if (!ctx.token) {
    // throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
  }
  // In reality, verify token and fetch user
  return next({ user: { id: "u_1", role: "admin" } });
});

// 2. Route-Level MFA Middleware (Auto-infers { mfaPassed: boolean })
export const verifyMfaMw = defineMiddleware<{ user: { id: string } }>()(
  async (ctx, next) => {
    return next({ mfaPassed: true });
  }
);

// 3. Logger Middleware (Demonstrating chainability)
export const loggerMw = defineMiddleware<{ ip: string | null }>()(
  async (ctx, next) => {
    console.log(`[Access Log] Request from IP: ${ctx.ip}`);
    return next({ traceId: `req_${Date.now()}` });
  }
);

export const appRouter = defineRoutes({
  modules: [dbModule, emailModule], // 👈 Perfect DI Isolation
  middlewares: [authMw, loggerMw], // 👈 Module-level onion pipeline
});
