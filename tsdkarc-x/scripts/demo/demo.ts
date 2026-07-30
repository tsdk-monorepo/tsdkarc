import { z } from "zod";
import { launchApp } from "../../src/server";
import { RpcError, type RoutesOf, type InferRouteTree } from "../../src/types";
import { HonoAdapter } from "../../src/hono-adapter";
import { ExpressAdapter } from "../../src/express-adapter";
import { apiReference } from "@scalar/express-api-reference";
import { appRouter, createContext, verifyMfaMw } from "./app";
import mockRoutes from "../routes";
import { extractOpenApi } from "../../src/scripts/openapi";

import { extractAppRoutesTypesFull } from "../../src/scripts/extract-types";
import fs from "fs/promises";
import path from "path";

import type { Context } from "hono";

const createContext2 = async (c: Context) => ({
  get token() {
    return c.req.header("Authorization") ?? null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Route Modules (The Business Logic)
// ─────────────────────────────────────────────────────────────────────────────

export const userRoutes = appRouter.init((r, ctx) => ({
  // ✅ Feature A: Plain Handler (Simplest form, no context, no schema)
  /** hello health api */
  health: () => "OK",

  // ✅ Feature B: Query without input schema (Accessing DI and Meta)
  ping: r.query(async (_, env) => {
    return {
      message: "pong",
      trace: env.meta.traceId, // Typed traceId from loggerMw
      user: env.meta.user.id, // Typed user from authMw
    };
  }),

  // ✅ Feature C: Query WITH Zod Schema & DI Injection
  getProfile: r.query(
    z.object({
      /** comment desc */
      includeHistory: z.boolean().default(false),
    }),
    async (input, env) => {
      // TS auto-completes env.ctx.db
      const user = env.ctx.db.findUser(env.meta.user.id);
      return { ...user, history: input.includeHistory ? [] : null };
    }
  ),

  getProfile2: r.query(
    async (input: { includeHistory: number[] } | undefined, env) => {
      // TS auto-completes env.ctx.db
      const user = env.ctx.db.findUser(env.meta.user.id);
      return { ...user, history: input?.includeHistory ? [] : null };
    }
  ),

  // ✅ Feature D: Route-Level Middleware & Mutation
  updatePassword: r
    .use(verifyMfaMw) // 🌟 Granular middleware only for this endpoint!
    .mutate(z.object({ newPwd: z.string().min(8) }), async (input, env) => {
      // Strict types check: env.meta now has `mfaPassed: boolean`
      if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
      return "Password updated securely";
    }),

  // ✅ Feature E: Serverless Background Tasks (waitUntil)
  registerDevice: r.mutate(
    z.object({ deviceId: z.string() }),
    async (input, env) => {
      // This HTTP request returns instantly...
      // But the email function runs safely in the background (Edge compatible!)
      env.waitUntil(
        env.ctx.email.sendBackgroundAlert(
          `New device logged in: ${input.deviceId}`
        )
      );
      return { success: true };
    }
  ),

  // ✅ Feature F: SSE Streaming (Generators)
  downloadLogs: r.stream(
    z.object({ lines: z.number().max(10) }),
    async function* (input, env) {
      // Streams chunks to the frontend in real-time
      for (let i = 0; i < input.lines; i++) {
        await new Promise((res) => setTimeout(res, 300)); // Simulate work
        yield { index: i, text: `Log trace ${env.meta.traceId} - Line ${i}` };
      }
    }
  ),

  // ✅ Feature G: Multipart File Uploads (with string coercion)
  uploadAvatar: r.upload(
    z.object({
      file: z.instanceof(File),
      // Coerce needed because FormData fields are always strings initially
      cropSize: z.coerce.number().min(100),
    }),
    async (input, ctx) => {
      return {
        fileName: input.file.name,
        size: input.file.size,
        croppedTo: input.cropSize,
      };
    }
  ),

  // ✅ Feature H: Controlled Errors
  triggerError: r.query(() => {
    // Automatically mapped to 404 HTTP Status by HonoAdapter
    throw new RpcError("NOT_FOUND", "This resource has been deleted.");
  }),

  // ✅ Feature I: Nested Namespaces
  settings: {
    getTheme: r.query(() => "dark_mode"),
    updateTheme: r.mutate(
      z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
      (input) => `Theme changed to ${input.theme}`
    ),
  },
}));

const routerA = appRouter.init((r, ctx) => ({
  a: r.query(async (input, ctx) => {
    ctx.meta.traceId;
    ctx.meta.user;
    return { a: 1 };
  }),

  // ✅ Feature A: Plain Handler (Simplest form, no context, no schema)
  health: () => "OK",

  // ✅ Feature B: Query without input schema (Accessing DI and Meta)
  ping: r.query(async (_, env) => {
    return {
      message: "pong",
      trace: env.meta.traceId, // Typed traceId from loggerMw
      user: env.meta.user.id, // Typed user from authMw
    };
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 4. Orchestration & Launch
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new ExpressAdapter();
// const honoAdapter = new HonoAdapter();

/*
adapter.app.use('*', cors({ origin: 'http://localhost:5173' })); // 给前端 Vite 放行跨域
adapter.app.use('*', logger());
*/
const routes = {
  v1: {
    users: userRoutes, // Accessible at /api/v1/users/...
  },
  a: routerA,
  mock: mockRoutes,
};

const port = process.env.PORT || 3000;
const basePath = "/api";
export const app = launchApp({
  basePath,
  transport: adapter,
  // Lazy evaluation: extracting headers costs 0 overhead if middlewares don't read them
  createContext,
  routes: routes,
  port,
}).then(async (res) => {
  console.time(`extract app routes types`);
  const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
    res.routes,
    {
      entryFile: path.resolve("./scripts/demo/demo.ts"),
      tsConfigFilePath: path.resolve("./tsconfig.json"),
      routesExportName: "routes",
      includeSourceLocation: false,
    }
  );

  await Promise.all([
    fs.writeFile("./scripts/demo/app-routes.d.ts", clientDts),
    fs.writeFile("./scripts/demo/app-routes-swr.d.ts", swrDts),
    fs.writeFile("./scripts/demo/app-routes-query.d.ts", reactQueryDts),
  ]);
  console.timeEnd(`extract app routes types`);

  console.time(`extract openapi`);
  const result = extractOpenApi(
    res.routes,
    {
      info: { title: "My API", version: "1.0.0" },
      servers: [{ url: `http://localhost:${port}/api` }],
    },
    {
      entryFile: path.resolve("./scripts/demo/demo.ts"), // Path to your main router
      routesExportName: "routes", // The variable name of your exported router
      tsConfigFilePath: path.resolve("./tsconfig.json"), // Optional, helps with path resolution
    }
  );
  adapter.app.get(`${basePath}/openapi`, async (req, res) => {
    res.json(result);
  });
  adapter.app.use(
    "/reference",
    apiReference({
      // Put your OpenAPI url here:
      url: `http://localhost:${port}${basePath}/openapi`,
    })
  );
  console.timeEnd(`extract openapi`);

  return res;
});

// 🌟 THE HOLY GRAIL: Exporting the pristine, inferred type for the frontend
export type AppRoutes = RoutesOf<typeof app>;
export type AppRoutes2 = InferRouteTree<typeof routes>;

// Graceful shutdown
app.then(({ stop }) => {
  process.on("SIGINT", async () => {
    console.log("\nShutting down safely...");
    await stop();
    process.exit(0);
  });
});
