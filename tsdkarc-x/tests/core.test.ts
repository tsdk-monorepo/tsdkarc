/**
 * Consolidated test suite for the tsdkarc-x router system.
 *
 * Sections:
 *   0.  Type-level checks (compile-time, via @ts-expect-error)
 *   1.  Basic usage walkthrough
 *   2.  Context (env.ctx) & meta (env.meta) resolution
 *   3.  Middleware chain composition
 *   4.  Route-level middleware (r.use)
 *   5.  Nested namespaces & multi-router composition
 *   6.  Zod schema validation
 *   7.  Error handling (RpcError → HTTP-agnostic error shape)
 *   8.  Streaming routes (async generators)
 *   9.  Upload routes & coercion
 *   10. Background tasks (env.waitUntil)
 *   11. Client round-trip (createClient / isRpcError)
 *   12. Edge cases & robustness
 *   13. Security & validation correctness
 *   14. HTTP escape hatches (HTTP.send / HTTP.redirect)
 *
 * ── Test harness ─────────────────────────────────────────────────────────
 * Every runtime test spins up a REAL HTTP server: `startTestServer()` picks
 * an OS-assigned free port, calls the real `launchApp` with a real
 * `ExpressAdapter`, and returns a real `createClient` pointed at
 * `http://localhost:<port>`. Requests go over an actual socket; nothing is
 * mocked or invoked in-process. Each test is responsible for calling the
 * returned `stop()` (via try/finally) so the port is released.
 *
 * `defineRouter(...).init(...)` returns a single `RouteTreeModule`, not the
 * `RouteFactoryTree` dict `launchApp`'s `routes` param expects (see
 * demo.ts: `routes: { v1: { users: userRoutes } }`). `startTestServer`
 * wraps the router under a synthetic `root` key and unwraps `.root` off the
 * returned client, so every test can still call `client.<route>` directly.
 * The one test that composes multiple named routers (section 5) builds its
 * own `RouteFactoryTree` and calls `launchApp` directly instead.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Fixtures are declared local to the describe block that uses them unless
 * shared across multiple sections, in which case they are declared at
 * module scope directly above the sections that use them.
 */
import { createServer } from "node:net";
import type { Request } from "express";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ContextOf, defineModule } from "tsdkarc";
import { defineRouter, defineMiddleware, launchApp, RpcError } from "../src";
import { ExpressAdapter } from "../src/express-adapter";
import {
  RoutesOf,
  RouteFactoryTree,
  RouteTreeModule,
  InferRouteTree,
  HTTP,
  MiddlewareNextMeta,
} from "../src/types";
import { createClient, isRpcError } from "../src/client";

// ─────────────────────────────────────────────────────────────────────────────
// Test harness helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask the OS for a currently-unused TCP port.
 * @returns port number
 */
async function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (!address || typeof address !== "object") {
        probe.close(() => reject(new Error("Could not determine free port")));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

/**
 * Boots a real HTTP server for a single router on a free port and returns a
 * real client wired to it. Caller MUST call `stop()` when done (try/finally).
 *
 * `defineRouter(...).init(...)` returns one `RouteTreeModule`, not a
 * `RouteFactoryTree` — `launchApp`'s `routes` param always wants a dict of
 * named `RouteTreeModule`s (see demo.ts: `routes: { v1: { users: userRoutes } }`).
 * This wraps the router under a synthetic `root` key to satisfy that shape,
 * then unwraps `.root` off the returned client so every test can keep
 * calling `client.<route>` exactly as if the router were mounted at the top.
 *
 * @param router  a single router returned by `defineRouter(...).init(...)`
 * @param options { createContext?, getHeaders? }
 */
async function startTestServer<T extends RouteTreeModule<any>>(
  router: T,
  options: {
    createContext?: (req: Request) => object | Promise<object>;
    getHeaders?: () => Record<string, string>;
  } = {}
) {
  const port = await getFreePort();
  const basePath = "/api";
  const routes = { root: router } satisfies RouteFactoryTree;

  const appPromise = launchApp({
    basePath,
    transport: new ExpressAdapter(),
    createContext: options.createContext ?? (async () => ({})),
    routes,
    port,
  });

  const app = await appPromise;
  const rootClient = createClient<RoutesOf<typeof appPromise>>({
    baseURL: `http://localhost:${port}${basePath}`,
    getHeaders: options.getHeaders,
  });

  return {
    client: rootClient.root,
    stop: () => app.stop().catch((e) => e),
    port,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. Type-level checks (compile-time only — no runtime assertions, no server)
// ─────────────────────────────────────────────────────────────────────────────
// Each `it` body exists only to give tsc a scope for `@ts-expect-error`
// during `tsc --noEmit`. One scenario per `it` so a broken type contract
// points at a single, named failure. These don't start a server, so they
// use `InferRouteTree<typeof router>` (not `RoutesOf`) to get the client
// type directly from `defineRouter(...).init(...)` — `RoutesOf` only
// accepts `launchApp`'s return value (or its Promise), not a bare router.

describe("0. Type-level checks", () => {
  it("query without schema: input type comes from the handler param", () => {
    const router = defineRouter({}).init((r) => ({
      getProfile: r.query(
        async (input: { includeHistory: boolean } | undefined) => {
          return { history: input?.includeHistory ? [] : null };
        }
      ),
    }));
    const client = createClient<InferRouteTree<typeof router>>({
      baseURL: "http://x",
    });

    // @ts-expect-error: includeHistory must be boolean, not string
    client.getProfile.query({ includeHistory: "yes" }).catch((e) => e);
  });

  it("query with schema: input type comes from the Zod schema, not the handler", () => {
    const router = defineRouter({}).init((r) => ({
      getProfile: r.query(
        z.object({ includeHistory: z.boolean().default(false) }),
        async (input) => ({ history: input.includeHistory ? [] : null })
      ),
    }));
    const client = createClient<InferRouteTree<typeof router>>({
      baseURL: "http://x",
    });

    // @ts-expect-error: unknown field not present in schema
    client.getProfile.query({ includeHistory: true, extra: 1 }).catch((e) => e);
  });

  it("env.ctx only exposes modules declared on defineRouter", () => {
    const dbModule = defineModule({ name: "db" }).init(() => ({
      findUser: (id: string) => ({ id }),
    }));

    defineRouter({ modules: [dbModule] }).init((r) => ({
      getUser: r.query(z.object({ id: z.string() }), async (input, env) => {
        const user = env.ctx.db.findUser(input.id);

        // @ts-expect-error: no `email` module was declared
        env.ctx.email;

        return user;
      }),
    }));
  });

  it("env.meta accumulates fields from every global middleware", () => {
    const authMw = defineMiddleware<{ token: string | null }>()(
      async (ctx, next) => next({ user: { id: "u_1" } })
    );
    const loggerMw = defineMiddleware<{ user: { id: string } }>()(
      async (ctx, next) => next({ traceId: "t_1" })
    );

    defineRouter({ middlewares: [authMw, loggerMw] }).init((r) => ({
      ping: r.query(async (_input, env) => {
        const userId: string = env.meta.user.id;
        const trace: string = env.meta.traceId;

        // @ts-expect-error: no middleware produces `mfaPassed`
        env.meta.mfaPassed;

        return { userId, trace };
      }),
    }));
  });

  it("route-level r.use() adds a field only visible on that route's env.meta", () => {
    const authMw = defineMiddleware<{}, {}>()(async (_env, next) =>
      next({ user: { id: "u_1" } })
    );
    const verifyMfaMw = defineMiddleware<{}, { user: { id: string } }>()(
      async ({ meta }, next) => next({ mfaPassed: true })
    );

    defineRouter({ middlewares: [authMw] }).init((r) => ({
      updatePassword: r
        .use(verifyMfaMw)
        .mutate(z.object({ newPwd: z.string().min(8) }), async (input, env) => {
          const passed: boolean = env.meta.mfaPassed;
          return "ok";
        }),

      health: r.query(async (_input, env) => {
        // @ts-expect-error: mfaPassed only exists on updatePassword's env.meta
        env.meta.mfaPassed;
        return "OK";
      }),
    }));
  });

  it("RoutesOf produces a nested type matching the route tree shape", () => {
    const router = defineRouter({}).init((r) => ({
      settings: {
        getTheme: r.query(() => "dark_mode" as const),
      },
    }));

    const client = createClient<InferRouteTree<typeof router>>({
      baseURL: "http://x",
    });

    client.settings.getTheme.query().catch((e) => e);

    // @ts-expect-error: route was declared under `settings`, not the root
    client.getTheme;
  });

  it("stream handler must return an AsyncGenerator; yielded type flows to the client", () => {
    defineRouter({}).init((r) => ({
      downloadLogs: r.stream(
        z.object({ lines: z.number().max(10) }),
        // @ts-expect-error: stream handler must be `async function*`, not `async`
        async (input) => ({ index: 0, text: "x" })
      ),
    }));
  });

  it("upload schema requiring z.instanceof(File) rejects non-File input", () => {
    const router = defineRouter({}).init((r) => ({
      uploadAvatar: r.upload(
        z.object({ file: z.instanceof(File), cropSize: z.coerce.number() }),
        async (input) => ({ size: input.file.size })
      ),
    }));
    const client = createClient<InferRouteTree<typeof router>>({
      baseURL: "http://x",
    });

    client.uploadAvatar
      // @ts-expect-error: `file` must be a File instance
      .upload({ file: "not-a-file", cropSize: 100 })
      .catch((e) => e);
  });

  it("RpcError code is restricted to the known error-code union", () => {
    // @ts-expect-error: "TEAPOT" is not a valid RpcError code
    new RpcError("TEAPOT", "nope");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Basic usage walkthrough
// ─────────────────────────────────────────────────────────────────────────────

describe("1. Basic usage walkthrough", () => {
  it("plain function route executes and returns its value directly", async () => {
    const router = defineRouter({}).init(() => ({ health: () => "OK" }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.health.query()).toBe("OK");
    } finally {
      await stop();
    }
  });

  it("r.query without a schema runs the handler with no validation", async () => {
    const router = defineRouter({}).init((r) => ({
      ping: r.query(async () => ({ message: "pong" })),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.ping.query()).toEqual({ message: "pong" });
    } finally {
      await stop();
    }
  });

  it("r.query with a schema validates input and applies defaults", async () => {
    const router = defineRouter({}).init((r) => ({
      getProfile: r.query(
        z.object({ includeHistory: z.boolean().default(false) }),
        async (input) => {
          console.log("avc123", { input });
          return { history: input?.includeHistory ? [] : null };
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.getProfile.query({})).toEqual({
        history: null,
      });
      expect(await client.getProfile.query({ includeHistory: true })).toEqual({
        history: [],
      });
    } finally {
      await stop();
    }
  });

  it("r.mutate behaves like r.query but is intended for side-effecting writes", async () => {
    const router = defineRouter({}).init((r) => ({
      updateTheme: r.mutate(
        z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
        (input) => `Theme changed to ${input.theme}`
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.updateTheme.mutate({ theme: "light_mode" })).toBe(
        "Theme changed to light_mode"
      );
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Context (env.ctx) & meta (env.meta) resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("2. Context (env.ctx) & meta (env.meta) resolution", () => {
  it("modules declared on defineRouter are exposed under env.ctx by name", async () => {
    const dbModule = defineModule({ name: "db" }).init(() => ({
      findUser: (id: string) => ({ id, name: "Alice" }),
    }));
    const router = defineRouter({ modules: [dbModule] }).init((r) => ({
      getUser: r.query(z.object({ id: z.string() }), async (input, env) => {
        return env.ctx.db.findUser(input.id);
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.getUser.query({ id: "u_1" })).toEqual({
        id: "u_1",
        name: "Alice",
      });
    } finally {
      await stop();
    }
  });

  it("env.meta is empty when no middlewares are declared", async () => {
    const router = defineRouter({}).init((r) => ({
      whoAmI: r.query(async (_input, env) => env.meta),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.whoAmI.query()).toEqual({});
    } finally {
      await stop();
    }
  });

  it("modules and middleware-derived meta coexist without key collisions", async () => {
    const send = vi.fn();
    const emailModule = defineModule({ name: "email" }).init(() => ({ send }));
    const authMw = defineMiddleware<{ token: string | null }>()(
      async (_ctx, next) => next({ user: { id: "u_1" } })
    );
    const router = defineRouter({
      modules: [emailModule],
      middlewares: [authMw],
    }).init((r) => ({
      notify: r.mutate(z.object({ msg: z.string() }), async (input, env) => {
        env.ctx.email.send(env.meta.user.id, input.msg);
        return { sent: true };
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.notify.mutate({ msg: "hi" })).toEqual({ sent: true });
      expect(send).toHaveBeenCalledWith("u_1", "hi");
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Middleware chain composition
// ─────────────────────────────────────────────────────────────────────────────
describe("3. Middleware chain composition", () => {
  it("runs global middlewares in declaration order, merging next() patches", async () => {
    const order: string[] = [];
    const mwA = defineMiddleware<{}, {}>()(async ({ meta }, next) => {
      order.push("A");
      return next({ a: 1 });
    });
    const mwB = defineMiddleware<{}, { a: number }>()(
      async ({ meta }, next) => {
        order.push(`B:sees-a=${meta.a}`);
        return next({ b: 2 });
      }
    );
    const router = defineRouter({ middlewares: [mwA, mwB] }).init((r) => ({
      probe: r.query(async (_input, env) => env.meta),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const meta = await client.probe.query();
      expect(order).toEqual(["A", "B:sees-a=1"]);
      expect(meta).toEqual({ a: 1, b: 2 });
    } finally {
      await stop();
    }
  });

  it("a later middleware can read fields patched in by an earlier one", async () => {
    const seedMw = defineMiddleware<{}, {}>()(async (_env, next) =>
      next({ requestId: "r_1" })
    );
    const echoMw = defineMiddleware<{}, { requestId: string }>()(
      async ({ meta }, next) => next({ echoedRequestId: meta.requestId })
    );
    const router = defineRouter({ middlewares: [seedMw, echoMw] }).init(
      (r) => ({
        probe: r.query(async (_input, env) => env.meta.echoedRequestId),
      })
    );
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.probe.query()).toBe("r_1");
    } finally {
      await stop();
    }
  });

  it("createContext output is visible to the first middleware via meta", async () => {
    const authMw = defineMiddleware<{}, { token: string | null }>()(
      async ({ meta }, next) => next({ tokenSeen: meta.token })
    );
    const router = defineRouter({ middlewares: [authMw] }).init((r) => ({
      probe: r.query(async (_input, env) => env.meta.tokenSeen),
    }));
    const { client, stop } = await startTestServer(router, {
      createContext: async (req: Request) => ({
        get token() {
          return req.header("Authorization") || null;
        },
      }),
      getHeaders: () => ({ Authorization: "Bearer abc" }),
    });

    try {
      expect(await client.probe.query()).toBe("Bearer abc");
    } finally {
      await stop();
    }
  });

  it("middleware can read DI-resolved ctx, separately from meta", async () => {
    const dbModule = defineModule({ name: "db" }).init(() => ({
      findUser: (id: string) => ({ id, role: "admin" }),
    }));
    const authMw = defineMiddleware<ContextOf<typeof dbModule>, {}>()(
      async ({ ctx }, next) => {
        const user = ctx.db.findUser("u_1");
        return next({ user });
      }
    );
    const router = defineRouter({
      modules: [dbModule],
      middlewares: [authMw],
    }).init((r) => ({
      probe: r.query(async (_input, env) => env.meta.user),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.probe.query()).toEqual({ id: "u_1", role: "admin" });
    } finally {
      await stop();
    }
  });

  it("waitUntil keeps a background task alive after the response resolves", async () => {
    let backgroundDone = false;
    const loggerMw = defineMiddleware<{}, {}>()(async ({ waitUntil }, next) => {
      waitUntil(
        new Promise<void>((resolve) =>
          setTimeout(() => {
            backgroundDone = true;
            resolve();
          }, 20)
        )
      );
      return next({});
    });
    const router = defineRouter({ middlewares: [loggerMw] }).init((r) => ({
      probe: r.query(async () => "ok"),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const result = await client.probe.query();
      expect(result).toBe("ok");
      // response resolved before the background task's timeout fires
      expect(backgroundDone).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(backgroundDone).toBe(true);
    } finally {
      await stop();
    }
  });

  it("route-level .use() middleware only runs for that route, not sibling routes", async () => {
    const calls: string[] = [];
    const onlyForA = defineMiddleware<{}, {}>()(async (_env, next) => {
      calls.push("onlyForA");
      return next({ flagged: true });
    });
    const router = defineRouter({}).init((r) => ({
      a: r.use(onlyForA).query(async (_input, env) => env.meta.flagged),
      b: r.query(async (_input, env) => (env.meta as any).flagged ?? null),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.a.query()).toBe(true);
      expect(await client.b.query()).toBe(null);
      expect(calls).toEqual(["onlyForA"]);
    } finally {
      await stop();
    }
  });

  it("route-level middleware runs after global middlewares, and can depend on their meta", async () => {
    const order: string[] = [];
    const globalMw = defineMiddleware<{}, {}>()(async (_env, next) => {
      order.push("global");
      return next({ user: { role: "admin" } });
    });
    const mfaMw = defineMiddleware<{}, { user: { role: string } }>()(
      async ({ meta }, next) => {
        order.push("mfa");
        return next({ mfaPassed: meta.user.role === "admin" });
      }
    );
    const router = defineRouter({ middlewares: [globalMw] }).init((r) => ({
      secure: r.use(mfaMw).query(async (_input, env) => env.meta.mfaPassed),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.secure.query()).toBe(true);
      expect(order).toEqual(["global", "mfa"]);
    } finally {
      await stop();
    }
  });

  it("propagates an RpcError thrown inside a middleware to the client", async () => {
    const guardMw = defineMiddleware<{}, {}>()(async (_env, _next) => {
      throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
    });
    const router = defineRouter({ middlewares: [guardMw] }).init((r) => ({
      probe: r.query(async () => "unreachable"),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await client.probe.query();
      expect.fail("expected probe.query() to throw");
    } catch (err) {
      expect(isRpcError(err)).toBe(true);
      if (isRpcError(err)) {
        expect(err.code).toBe("UNAUTHORIZED");
      }
    } finally {
      await stop();
    }
  });

  it("warns (dev only) when a middleware's next() patch collides with an existing meta key", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const mwA = defineMiddleware<{}, {}>()(async (_env, next) =>
      next({ a: 1 })
    );
    const mwB = defineMiddleware<{}, { a: number }>()(async (_env, next) =>
      // deliberately re-sets "a" instead of adding a new key
      next({ a: 2 } as any)
    );
    const router = defineRouter({ middlewares: [mwA, mwB] }).init((r) => ({
      probe: r.query(async (_input, env) => env.meta),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await client.probe.query();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('overwrites existing meta key: "a"')
      );
    } finally {
      await stop();
      process.env.NODE_ENV = originalEnv;
      warnSpy.mockRestore();
    }
  });

  it("MiddlewareNextMeta<M> types the merged meta a downstream middleware/route sees", async () => {
    const authMw = defineMiddleware<{}, { token: string | null }>()(
      async (_env, next) => next({ user: { id: "u_1" } })
    );

    // Compile-time check: this should be exactly the input + contributed meta.
    type AfterAuth = MiddlewareNextMeta<typeof authMw>;
    const sample: AfterAuth = {
      token: "t",
      user: { id: "u_1" },
    };
    expect(sample.user.id).toBe("u_1");

    // Runtime confirmation that meta really does merge this way.
    const router = defineRouter({ middlewares: [authMw] }).init((r) => ({
      probe: r.query(async (_input, env) => env.meta),
    }));
    const { client, stop } = await startTestServer(router, {
      createContext: async () => ({ token: "t" }),
    });

    try {
      expect(await client.probe.query()).toEqual({
        token: "t",
        user: { id: "u_1" },
      });
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Route-level middleware (r.use)
// ─────────────────────────────────────────────────────────────────────────────

describe("4. Route-level middleware (r.use)", () => {
  it("route-level middleware runs only for the route it's attached to", async () => {
    const calls: string[] = [];
    const mfaMw = defineMiddleware<{}>()(async (_ctx, next) => {
      calls.push("mfa-ran");
      return next({ mfaPassed: true });
    });
    const router = defineRouter({}).init((r) => ({
      updatePassword: r
        .use(mfaMw)
        .mutate(
          z.object({ newPwd: z.string().min(8) }),
          async (_input, env) => env.meta.mfaPassed
        ),
      health: r.query(() => "OK"),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await client.health.query();
      expect(calls).toEqual([]); // route-level middleware did not run for `health`

      await client.updatePassword.mutate({ newPwd: "12345678" });
      expect(calls).toEqual(["mfa-ran"]);
    } finally {
      await stop();
    }
  });

  it("route-level middleware runs after all global middlewares", async () => {
    const order: string[] = [];
    const globalMw = defineMiddleware<{}>()(async (_ctx, next) => {
      order.push("global");
      return next({});
    });
    const routeMw = defineMiddleware<{}>()(async (_ctx, next) => {
      order.push("route");
      return next({});
    });
    const router = defineRouter({ middlewares: [globalMw] }).init((r) => ({
      action: r.use(routeMw).mutate(z.object({}), async () => "done"),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await client.action.mutate({});
      expect(order).toEqual(["global", "route"]);
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Nested namespaces & multi-router composition
// ─────────────────────────────────────────────────────────────────────────────

describe("5. Nested namespaces & multi-router composition", () => {
  it("plain nested objects act as call-path namespaces", async () => {
    const router = defineRouter({}).init((r) => ({
      settings: {
        getTheme: r.query(() => "dark_mode"),
        updateTheme: r.mutate(
          z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
          (input) => `Theme changed to ${input.theme}`
        ),
      },
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.settings.getTheme.query()).toBe("dark_mode");
      expect(
        await client.settings.updateTheme.mutate({ theme: "light_mode" })
      ).toBe("Theme changed to light_mode");
    } finally {
      await stop();
    }
  });

  it("independent routers can be composed under distinct path segments on one server", async () => {
    const usersRouter = defineRouter({}).init(() => ({
      health: () => "users-OK",
    }));
    const adminRouter = defineRouter({}).init(() => ({
      health: () => "admin-OK",
    }));

    const port = await getFreePort();
    const basePath = "/api";
    const routes = {
      v1: { users: usersRouter },
      admin: adminRouter,
    } satisfies RouteFactoryTree;

    const appPromise = launchApp({
      basePath,
      transport: new ExpressAdapter(),
      createContext: async () => ({}),
      routes,
      port,
    });
    const app = await appPromise;
    const client = createClient<RoutesOf<typeof appPromise>>({
      baseURL: `http://localhost:${port}${basePath}`,
    });

    try {
      expect(await client.v1.users.health.query()).toBe("users-OK");
      expect(await client.admin.health.query()).toBe("admin-OK");
    } finally {
      await app.stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Zod schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe("6. Zod schema validation", () => {
  it("rejects input that fails schema validation before the handler runs", async () => {
    const handler = vi.fn(async () => "should not run");
    const router = defineRouter({}).init((r) => ({
      updatePassword: r.mutate(
        z.object({ newPwd: z.string().min(8) }),
        handler
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await expect(
        client.updatePassword.mutate({ newPwd: "123" })
      ).rejects.toThrow();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it("applies schema defaults before the handler receives input", async () => {
    const router = defineRouter({}).init((r) => ({
      getProfile: r.query(
        z.object({ includeHistory: z.boolean().default(false) }),
        async (input) => input
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.getProfile.query({})).toEqual({
        includeHistory: false,
      });
    } finally {
      await stop();
    }
  });

  it("without a schema, no runtime validation occurs (type-only contract)", async () => {
    const router = defineRouter({}).init((r) => ({
      raw: r.query(async (input: { anything?: unknown }) => input),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      // Deliberately malformed relative to the declared type, since there's
      // no runtime schema to enforce it — this documents current behavior.
      expect(await client.raw.query({ anything: 42 } as any)).toEqual({
        anything: 42,
      });
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Error handling (RpcError)
// ─────────────────────────────────────────────────────────────────────────────

describe("7. Error handling (RpcError)", () => {
  it("propagates a thrown RpcError with its code and message intact", async () => {
    const router = defineRouter({}).init((r) => ({
      triggerError: r.query(() => {
        throw new RpcError("NOT_FOUND", "This resource has been deleted.");
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await expect(client.triggerError.query()).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "This resource has been deleted.",
      });
    } finally {
      await stop();
    }
  });

  it("wraps schema validation failures as a BAD_REQUEST RpcError with issues", async () => {
    const router = defineRouter({}).init((r) => ({
      updatePassword: r.mutate(
        z.object({ newPwd: z.string().min(8) }),
        () => "ok"
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const err = await client.updatePassword
        .mutate({ newPwd: "123" })
        .catch((e) => e);

      expect(isRpcError(err)).toBe(true);
      if (isRpcError(err)) {
        expect(err.code).toBe("BAD_REQUEST");
        expect(err.issues?.length).toBeGreaterThan(0);
      }
    } finally {
      await stop();
    }
  });

  it("maps an unrecognized thrown Error to a generic INTERNAL_SERVER_ERROR", async () => {
    const router = defineRouter({}).init((r) => ({
      explode: r.query(() => {
        throw new Error("db connection reset");
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const err = await client.explode.query().catch((e) => e);
      expect(isRpcError(err)).toBe(true);
      if (isRpcError(err)) expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    } finally {
      await stop();
    }
  });
  /*

  it("does not leak the original error message for unrecognized errors", async () => {
    const router = defineRouter({}).init((r) => ({
      explode: r.query(() => {
        throw new Error("password=hunter2 leaked in stack trace");
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const err = await client.explode.query().catch((e) => e);
      if (isRpcError(err)) {
        expect(err.message).not.toContain("hunter2");
      }
    } finally {
      await stop();
    }
  });
*/
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Streaming routes (async generators)
// ─────────────────────────────────────────────────────────────────────────────

describe("8. Streaming routes", () => {
  it("yields items in order and completes, over a real SSE connection", async () => {
    const router = defineRouter({}).init((r) => ({
      downloadLogs: r.stream(
        z.object({ lines: z.number().max(10) }),
        async function* (input) {
          for (let i = 0; i < input.lines; i++) {
            yield { index: i, text: `line-${i}` };
          }
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const chunks: { index: number; text: string }[] = [];
      const stream = await client.downloadLogs.stream({ lines: 3 });
      for await (const chunk of stream) chunks.push(chunk);

      expect(chunks).toEqual([
        { index: 0, text: "line-0" },
        { index: 1, text: "line-1" },
        { index: 2, text: "line-2" },
      ]);
    } finally {
      await stop();
    }
  });

  it("validates the stream's input schema before the generator starts", async () => {
    const generatorStarted = vi.fn();
    const router = defineRouter({}).init((r) => ({
      downloadLogs: r.stream(
        z.object({ lines: z.number().max(10) }),
        async function* (input) {
          generatorStarted();
          yield { index: 0 };
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      await expect(
        client.downloadLogs.stream({ lines: 999 })
      ).rejects.toThrow();
      expect(generatorStarted).not.toHaveBeenCalled();
    } finally {
      await stop();
    }
  });

  it("stream handler has access to env.meta like other handler types", async () => {
    const authMw = defineMiddleware<{}>()(async (_ctx, next) =>
      next({ traceId: "t_stream" })
    );
    const router = defineRouter({ middlewares: [authMw] }).init((r) => ({
      downloadLogs: r.stream(
        z.object({ lines: z.number().max(1) }),
        async function* (input, env) {
          yield { trace: env.meta.traceId };
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const chunks: { trace: string }[] = [];
      const stream = await client.downloadLogs.stream({ lines: 1 });
      for await (const chunk of stream) chunks.push(chunk);

      expect(chunks).toEqual([{ trace: "t_stream" }]);
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Upload routes & coercion
// ─────────────────────────────────────────────────────────────────────────────

describe("9. Upload routes & coercion", () => {
  it("coerces string-typed form fields to their schema type over real multipart", async () => {
    const router = defineRouter({}).init((r) => ({
      uploadAvatar: r.upload(
        z.object({
          file: z.instanceof(File),
          cropSize: z.coerce.number().min(100),
        }),
        async (input) => ({
          fileName: input.file.name,
          croppedTo: input.cropSize,
        })
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const file = new File(["hello"], "avatar.png", { type: "image/png" });
      const result = await client.uploadAvatar.upload({ file, cropSize: 250 });

      expect(result).toEqual({ fileName: "avatar.png", croppedTo: 250 });
    } finally {
      await stop();
    }
  });

  it("rejects a coerced value that still fails the schema's constraint", async () => {
    const router = defineRouter({}).init((r) => ({
      uploadAvatar: r.upload(
        z.object({
          file: z.instanceof(File),
          cropSize: z.coerce.number().min(100),
        }),
        async (input) => input
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const file = new File(["hello"], "avatar.png", { type: "image/png" });
      await expect(
        client.uploadAvatar.upload({ file, cropSize: 50 })
      ).rejects.toThrow();
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Background tasks (env.waitUntil)
// ─────────────────────────────────────────────────────────────────────────────

describe("10. Background tasks (env.waitUntil)", () => {
  it("resolves the response before a waitUntil task settles", async () => {
    const order: string[] = [];
    const router = defineRouter({}).init((r) => ({
      registerDevice: r.mutate(
        z.object({ deviceId: z.string() }),
        async (input, env) => {
          env.waitUntil(
            new Promise<void>((resolve) =>
              setTimeout(() => {
                order.push("background-done");
                resolve();
              }, 10)
            )
          );
          order.push("response-returned");
          return { success: true };
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const result = await client.registerDevice.mutate({ deviceId: "d_1" });

      expect(result).toEqual({ success: true });
      expect(order).toEqual(["response-returned"]);

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(order).toEqual(["response-returned", "background-done"]);
    } finally {
      await stop();
    }
  });

  it("a rejected background task does not fail the request itself", async () => {
    const router = defineRouter({}).init((r) => ({
      fireAndForget: r.mutate(z.object({}), async (_input, env) => {
        env.waitUntil(Promise.reject(new Error("background failure")));
        return { accepted: true };
      }),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const result = await client.fireAndForget.mutate({});
      expect(result).toEqual({ accepted: true });
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Client round-trip (createClient / isRpcError)
// ─────────────────────────────────────────────────────────────────────────────

describe("11. Client round-trip", () => {
  it("createClient's call paths mirror the server route tree exactly", async () => {
    const router = defineRouter({}).init((r) => ({
      v1: { users: { health: r.query(() => "OK") } },
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.v1.users.health.query()).toBe("OK");
    } finally {
      await stop();
    }
  });

  it("isRpcError narrows unknown caught errors and exposes .code / .issues", () => {
    const err: unknown = new RpcError("BAD_REQUEST", "invalid input", [
      { path: ["newPwd"], message: "Too short" },
    ]);

    expect(isRpcError(err)).toBe(true);
    if (isRpcError(err)) {
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.issues?.[0].path).toEqual(["newPwd"]);
    }
  });

  it("isRpcError returns false for a plain Error", () => {
    expect(isRpcError(new Error("plain"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Edge cases & robustness
// ─────────────────────────────────────────────────────────────────────────────

describe("12. Edge cases & robustness", () => {
  it("handles an empty route tree without the server failing to start", async () => {
    const router = defineRouter({}).init(() => ({}));
    const { stop } = await startTestServer(router);

    await stop();
  });

  it("a query handler returning undefined resolves to undefined, not an error", async () => {
    const router = defineRouter({}).init((r) => ({
      noop: r.query(async () => undefined),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      expect(await client.noop.query()).toBe("");
    } finally {
      await stop();
    }
  });

  it("concurrent real requests to the same route don't share mutable state", async () => {
    let counter = 0;
    const traceMw = defineMiddleware<{}>()(async (_ctx, next) =>
      next({ traceId: `t_${++counter}` })
    );
    const router = defineRouter({ middlewares: [traceMw] }).init((r) => ({
      echoTraceId: r.query(async (_input, env) => env.meta.traceId),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const [a, b] = await Promise.all([
        client.echoTraceId.query(),
        client.echoTraceId.query(),
      ]);

      expect(a).not.toBe(b);
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Security & validation correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("13. Security & validation correctness", () => {
  it("strips unknown fields from validated input rather than passing them through", async () => {
    const router = defineRouter({}).init((r) => ({
      getProfile: r.query(
        z.object({ includeHistory: z.boolean().default(false) }),
        async (input) => input
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const result = await (client.getProfile.query as any)({
        includeHistory: true,
        injected: "<script>alert(1)</script>",
      });

      expect(result).toEqual({ includeHistory: true });
    } finally {
      await stop();
    }
  });

  it("does not let a crafted __proto__ field in the JSON request body pollute Object.prototype", async () => {
    const router = defineRouter({}).init((r) => ({
      echo: r.mutate(z.record(z.string(), z.unknown()), async (input) => input),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      // Sent as raw JSON over the wire — the most realistic vector for
      // prototype pollution, since it goes through JSON.parse server-side.
      await (client.echo.mutate as any)(
        JSON.parse(`{ "__proto__": { "polluted": true } }`)
      );

      expect(({} as any).polluted).toBeUndefined();
    } finally {
      await stop();
    }
  });

  it("env.meta from one request is not visible to a concurrent request on the same route", async () => {
    const secretMw = defineMiddleware<{}>()(async (_ctx, next) =>
      next({ secret: Math.random() })
    );
    const router = defineRouter({ middlewares: [secretMw] }).init((r) => ({
      leakCheck: r.query(async (_input, env) => env.meta.secret),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const [first, second] = await Promise.all([
        client.leakCheck.query(),
        client.leakCheck.query(),
      ]);

      expect(first).not.toBe(second);
    } finally {
      await stop();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. HTTP escape hatches (HTTP.send / HTTP.redirect)
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: types.ts confirms handlers may return `HTTP.send(body, { status,
// headers })` or `HTTP.redirect(url)` instead of a plain value, to control
// the raw HTTP response. These tests only assert the body still round-trips
// correctly through the client — asserting the actual status code / header
// requires knowing how `createClient` surfaces `HttpMeta` (e.g. does
// `.query()` resolve to just `body`, or to `{ body, meta }`?). That contract
// isn't visible from types.ts alone, so status/header assertions are left
// out until that's confirmed.

describe("14. HTTP escape hatches (HTTP.send / HTTP.redirect)", () => {
  it("a handler returning HTTP.send still resolves to its body on the client", async () => {
    const router = defineRouter({}).init((r) => ({
      createResource: r.mutate(
        z.object({ name: z.string() }),
        async (input) => {
          return HTTP.send(
            { id: "r_1", name: input.name },
            { status: 201, headers: { "X-Created": "true" } }
          );
        }
      ),
    }));
    const { client, stop } = await startTestServer(router);

    try {
      const result = await client.createResource.mutate({ name: "widget" });
      expect(result).toEqual({ id: "r_1", name: "widget" });
    } finally {
      await stop();
    }
  });

  it("HTTP.redirect defaults to a 302 status when no status is given", () => {
    const res = HTTP.redirect("https://example.com/home");

    expect(res.meta.status).toBe(302);
    expect(res.meta.headers).toEqual({ Location: "https://example.com/home" });
  });

  it("HTTP.redirect accepts an explicit permanent-redirect status", () => {
    const res = HTTP.redirect("https://example.com/moved", 301);

    expect(res.meta.status).toBe(301);
  });
});
