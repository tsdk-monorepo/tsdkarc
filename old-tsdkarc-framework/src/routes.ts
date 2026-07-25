// routes.ts
import { z } from "zod";
import { defineModule } from "tsdkarc";
import { authMiddleware } from "./middleware";
import { openApiRoute } from "./openapi/module";
import { defineRouter, createApp } from "./base";

// --- 1. Dependency Modules ---

/** Configuration module providing static settings. */
const configModule = defineModule()({
  name: "config",
  boot: () => ({
    config: { a: 1 },
  }),
});

/** Database module demonstrating module injection (depends on config). */
const dbModule = defineModule()({
  name: "db",
  modules: [configModule] as const,
  boot: () => ({
    db: { find: (id: string) => ({ id, name: "Database Record" }) },
  }),
});

// --- 2. Route Definitions ---

/** Core API routes demonstrating queries, mutations, and namespaces. */
export const apiRoutes = defineRouter({
  modules: [dbModule], // Injecting the DB module
})({
  /** Basic query with Zod validation. */
  hello(ctx) {
    return ctx.query(z.object({ name: z.string().min(6) }), (data, meta) => ({
      msg: "hello",
      name: data.name,
    }));
  },

  /** Mutation pattern for creating or updating data. */
  updateSettings(ctx) {
    return ctx.mutate(
      z.object({ theme: z.enum(["light", "dark"]) }),
      (data, meta) => {
        console.log(meta().headers);
        return {
          success: true,
          theme: data.theme,
        };
      }
    );
  },

  /** Mutation pattern for creating or updating data. */
  updateSettingsOptional(ctx) {
    return ctx.mutate(
      z.object({ theme: z.enum(["light", "dark"]).optional() }),
      (data) => ({
        success: true,
        theme: data.theme,
      })
    );
  },
});

const userRoutes = defineRouter()({
  /** Namespace to group related routes. */
  users: {
    /** Fetch a user by ID. */
    get(ctx) {
      return ctx.query(z.object({ id: z.string() }), (data) => ({
        id: data.id,
        status: "active",
      }));
    },
  },
});

/** Routes requiring authentication middleware. */
export const secureRoutes = defineRouter({ middleware: [authMiddleware] })({
  /** Returns sensitive data only if authMiddleware passes. */
  secret(ctx) {
    return { data: "eyes only" };
  },
});

// /** Streaming specific routes. */
export const streamRoutes = defineRouter()({
  /** * Yields data chunks over time.
   * Useful for LLM responses or long-running tasks.
   */
  chat(ctx) {
    return ctx.stream(
      z.object({ message: z.string() }),
      async function* (data) {
        const words = data.message.split(" ");
        for (const word of words) {
          yield { type: "delta", text: word + " " };
          await new Promise((r) => setTimeout(r, 50)); // simulate latency
        }
        yield { type: "done" };
      }
    );
  },

  /** Demonstrates error handling mid-stream. */
  errorStream(ctx) {
    return ctx.stream(async function* () {
      yield { n: 1 };
      throw new Error("Mid-stream failure");
    });
  },
});

// // --- 3. App Initialization ---

// /** * Combines modules, routes, and OpenAPI specs into the final app instance.
//  */
const app = createApp(
  [
    apiRoutes,
    secureRoutes,
    streamRoutes,
    userRoutes,
    openApiRoute(
      {
        appFile: new URL(import.meta.url).pathname,
        info: { title: "My Clean API", version: "1.0.0" },
        servers: [{ url: "http://localhost:5001/x" }],
      },
      defineRouter
    ),
  ],
  {
    afterBoot(ctx) {
      console.log("🚀 Server successfully booted!");
    },
    onError(err, ctx, mod) {
      console.error(`❌ [${mod.name}] boot error:`, err.message);
      throw err;
    },
  }
);

export type App = typeof app;
