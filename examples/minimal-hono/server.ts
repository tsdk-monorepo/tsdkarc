// server.ts
import {
  defineMiddleware,
  defineRouter,
  launchApp,
  RpcError,
  type DeepFlat,
  type MiddlewareExt,
  type MiddlewareNextMeta,
  type RoutesOf,
} from "tsdkarc-x";
import { HonoAdapter } from "tsdkarc-x/hono";
import type { Context } from "hono";
import { z } from "zod";
import { extractOpenApi } from "tsdkarc-x/openapi"; // TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // TypeScript v7 is currently not supported.
import { Scalar } from "@scalar/hono-api-reference";
import fs from "fs/promises";
import path from "path";
import { defineModule, type ContextOf } from "tsdkarc";

// ─────────────────────────────────────────────────────────────────────────
// 1. Context & Middleware
// ─────────────────────────────────────────────────────────────────────────

/**
 * Request-scoped dependency injection container.
 * Rebuilt on every request; must not hold cross-request mutable state.
 * @param c  incoming Hono Context
 * @returns ctx  object exposed to handlers as env.ctx
 */
const createContext = async (c: Context) => ({
  get token() {
    return c.req.header("Authorization") || "";
  },
  get mfaToken() {
    return c.req.header("X-MFA-Token");
  },
});

const sharedModule = defineModule().init(() => ({
  db: {
    findUser: (id: string) => ({ id, name: "Demo User" }),
  },
  email: {
    sendBackgroundAlert: async (message: string) => {
      console.log("[email:background]", message);
    },
  },
}));

export type BaseCtx = ContextOf<typeof sharedModule>;
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

/**
 * Auth middleware.
 * Reads the Authorization header and attaches user + traceId to env.meta.
 * Applied router-wide via defineRouter's middlewares option.
 * @throws RpcError UNAUTHORIZED when the header is missing
 */
export const authMw = defineMiddleware<BaseCtx, RequestMeta>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token)
      throw new RpcError("UNAUTHORIZED", "Missing Authorization header");
    return next({
      traceId: crypto.randomUUID(),
      user: { id: "user_1", mfaToken: meta.mfaToken },
    });
  }
);

/**
 * MFA middleware.
 * Route-level only (attached via r.use). Adds env.meta.mfaPassed.
 */
export const verifyMfaMw = defineMiddleware<
  BaseCtx,
  MiddlewareNextMeta<typeof authMw>
>()(async ({ meta, ctx }, next) => {
  console.log({ meta, ctx });
  return next({ mfaPassed: meta.user.mfaToken === "admin" });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Router
// ─────────────────────────────────────────────────────────────────────────

const appRouter = defineRouter({
  middlewares: [authMw],
  modules: [sharedModule],
});

const userRoutes = appRouter.init((r) => ({
  /** Liveness probe, no context or schema needed. */
  health: () => "ok",

  /** Query without input schema; reads DI and meta. */
  ping: r.query(async (_, env) => ({
    message: "pong",
    trace: env.meta.traceId,
    user: env.meta.user.id,
  })),

  /** Query with a Zod input schema and DI-backed lookup. */
  getProfile: r.query(
    z.object({
      /** whether to include the user's history in the response */
      includeHistory: z.boolean().default(false),
    }),
    async (input, env) => {
      const user = env.ctx.db.findUser(env.meta.user.id);
      return { ...user, history: input.includeHistory ? [] : null };
    }
  ),

  /** Route-level middleware + mutation guarded by MFA. */
  updatePassword: r
    .use(verifyMfaMw)
    .mutate(z.object({ newPwd: z.string().min(8) }), async (input, env) => {
      if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
      return "Password updated securely";
    }),

  /** Mutation with a background task via env.waitUntil (edge-compatible). */
  registerDevice: r.mutate(
    z.object({ deviceId: z.string() }),
    async (input, env) => {
      env.waitUntil(
        env.ctx.email.sendBackgroundAlert(
          `New device logged in: ${input.deviceId}`
        )
      );
      return { success: true };
    }
  ),

  /** SSE streaming via an async generator. */
  downloadLogs: r.stream(
    z.object({ lines: z.number().max(10) }),
    async function* (input, env) {
      for (let i = 0; i < input.lines; i++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        yield { index: i, text: `Log trace ${env.meta.traceId} - Line ${i}` };
      }
    }
  ),

  /** Multipart upload; FormData fields are strings, so cropSize is coerced. */
  uploadAvatar: r.upload(
    z.object({
      file: z.instanceof(File),
      cropSize: z.coerce.number().min(100),
    }),
    async (input) => ({
      fileName: input.file.name,
      size: input.file.size,
      croppedTo: input.cropSize,
    })
  ),

  /** Controlled error, mapped to HTTP 404 by the transport adapter. */
  triggerError: r.query(() => {
    throw new RpcError("NOT_FOUND", "This resource has been deleted.");
  }),

  /** Nested namespace grouping related endpoints. */
  settings: {
    getTheme: r.query(() => "dark_mode"),
    updateTheme: r.mutate(
      z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
      (input) => `Theme changed to ${input.theme}`
    ),
  },
}));

const routes = { users: userRoutes }; // routesExportName

// ─────────────────────────────────────────────────────────────────────────
// 3. Launch
// ─────────────────────────────────────────────────────────────────────────

const transport = new HonoAdapter();
export const app = await launchApp({
  basePath: "/api",
  transport,
  createContext,
  routes,
  port: 3015,
});

// Generate OpenAPI JSON
const openapiResult = extractOpenApi(
  app.routes,
  {
    info: { title: "API", version: "1.0.0" },
    servers: [{ url: `http://localhost:3015/api` }],
  },
  { entryFile: path.resolve("./server.ts"), routesExportName: "routes" }
);
transport.app.get(`/api/openapi`, async (c) => {
  return c.json(openapiResult);
});
transport.app.use(
  "/reference",
  Scalar({
    url: `http://localhost:3015/api/openapi`,
  })
);

export type AppRoutes = RoutesOf<typeof app>;

// Generate static client types
const { clientDts, swrDts, reactQueryDts, vueQueryDts } =
  await extractAppRoutesTypesFull(app.routes, {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  });

await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
  fs.writeFile("./client/api-vue-query.d.ts", vueQueryDts),
]);

// Smoke test
await fetch("http://localhost:3015/api/users/health", {
  headers: { Authorization: "x--11" },
})
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });

// ─────────────────────────────────────────────────────────────────────────
// 4. Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("Shutting down safely...");
  await app.stop();
  process.exit(0);
});
