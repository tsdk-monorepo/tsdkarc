# tsdkarc-x

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Built on tsdkarc](https://img.shields.io/badge/built%20on-tsdkarc-orange.svg)](https://www.npmjs.com/package/tsdkarc)
[![CI](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml/badge.svg)](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml)

🇺🇸 English · [🇨🇳 中文](./README.zh-CN.md)

## Introduction

`tsdkarc-x` is an end-to-end type-safe RPC framework based on `tsdkarc`. With it, after you write your routes on the server, the frontend client can directly get the corresponding request types, API methods, and React/Vue hooks.

---

## Why use it / Pain points solved

1. **No frontend-backend type gap**: Frontend doesn't need to manually define API types or rely on extra code generation steps. Server input and return types are automatically inferred to the frontend caller, Include API call function, and React/Vue hooks(SWR/Tanstack Query).
2. **No duplicate types & validation**: By integrating Zod, you get runtime validation on the server while directly inferring static types from the Schema (optional). Keeps runtime and static types in sync.
3. **Messy context & dependency management**: Based on `tsdkarc`'s type-safe DI module system, it automatically infers types for databases, global middlewares, and request-level context. No more passing `any` around or manual type casting.
4. **Framework lock-in**: Routes and business logic are decoupled from the underlying HTTP framework (like Express or Hono). You don't need to rewrite business code when switching frameworks.

---

## Examples

- [Next.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/nextjs-example/)
- [Minimal Express.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/minimal-express/)
- [Minimal Hono.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/minimal-hono/)

Want more examples? [Request one](https://github.com/tsdk-monorepo/tsdkarc/issues).

---

## Quick Start

### 1. Install Dependencies

```bash
npm install tsdkarc-x tsdkarc zod
# npm install express multer @types/multer @types/express @scalar/express-api-reference
# npm install hono @hono/node-server @scalar/hono-api-reference
```

> Note: Install the HTTP framework required by your adapter, such as `express`, `hono`, or any Web Standard `fetch`-compatible framework that supports the `Request`/`Response` API.

### 2. Server: Define routes and start the app

With **Bun**:

```ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { FetchAdapter, toFetchHandler } from "tsdkarc-x/fetch";

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define specific routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new FetchAdapter({ log: true });

// 3. Start server
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 0,
});

const fetchHandler = toFetchHandler(transport);
const server = Bun.serve({
  port: 3002,
  fetch(req) {
    return fetchHandler(req);
  },
});

console.log(`Backend listening on http://localhost:${server.port}`);

// 4. Export route types for frontend
export type AppRoutes = RoutesOf<typeof app>;
```

With **Express.js**:

```ts
// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express";

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define specific routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new ExpressAdapter({ log: true });

// 3. Start server
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3000,
});

// 4. Export route types for frontend
export type AppRoutes = RoutesOf<typeof app>;

// 5. test
await fetch("http://localhost:3000/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });
```

### 2.1 Generate OpenAPI Documentation

```ts
// ...previous code

import { extractOpenApi } from "tsdkarc-x/openapi"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
// import { extractOpenApi, extractAppRoutesTypesFull } from "tsdkarc/scripts";
import { apiReference } from "@scalar/express-api-reference";
import fs from "fs/promises";
import path from "path";

// Generate OpenAPI JSON result
const openapi = extractOpenApi(
  app.routes,
  {
    info: { title: "API", version: "1.0.0" },
  },
  { entryFile: "./server.ts" }
);
// Visit openapi.json: http://localhost:3000/api/openapi
transport.app.get(`/api/openapi`, async (req, res) => {
  res.json(openapiResult);
});

// Visit openapi UI http://localhost:3000/reference
transport.app.use(
  "/reference",
  apiReference({
    // Put your OpenAPI URL here:
    url: `http://localhost:3000/api/openapi`,
  })
);
```

### 2.2 Export Static API Types for Easy Distribution

```ts
// ...previous code

// Generate static type declaration files
const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
  app.routes,
  {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  }
);

// Write generated type files
await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
]);
```

### 3. Frontend: Create client and call APIs

```bash
npm install swr
# npm install @tanstack/react-query
# npm install @tanstack/vue-query

```

```ts
// client.ts
import { createClient } from "tsdkarc-x/client";

import { createSwrClient } from "tsdkarc-x/react/swr"; // For react.js hooks
import { createQueryClient as createReactQueryClient } from "tsdkarc-x/react/query"; // For react.js hooks
import { createQueryClient as createVueQueryClient } from "tsdkarc-x/vue/query"; // For vue 3 hooks

import type { AppRoutes } from "./server";

const client = createClient<AppRoutes>({
  baseURL: "http://localhost:3000/api",
});

const health = await client.users.health.query(); // "OK", with full autocomplete and type hints

// const swrHooks = createSwrClient<AppRoutes>(client); // React swr hooks
// swrHooks.users.health.useQuery()
// const reactQueryHooks = createReactQueryClient<AppRoutes>(client); // React tanstack query hooks
// const vueQueryHooks = createVueQueryClient<AppRoutes>(client); // Vue 3 tanstack query hooks
```

---

## Common Examples

### Input Validation (Zod Schema)

Just pass a Zod Schema to `r.query` or `r.mutate` for automatic validation and type inference.

```ts
const userRoutes = appRouter.init((r) => ({
  // Query
  getProfile: r.query(
    z.object({ includeHistory: z.boolean().default(false) }),
    async (input) => {
      return { id: "u_1", history: input.includeHistory ? [] : null };
    }
  ),
  // Mutate
  updateTheme: r.mutate(
    z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
    (input) => `Theme changed to ${input.theme}`
  ),
}));
```

### Dependency Injection (DI)

Reuse the `tsdkarc` module system to inject dependencies like your DB. Types are automatically passed to handlers.

```ts
import { defineModule } from "tsdkarc";

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
}));

export const appRouter = defineRouter({
  modules: [dbModule], // Register dependencies
});

const userRoutes = appRouter.init((r) => ({
  getProfile: r.query(z.object({ id: z.string() }), async (input, env) => {
    // env.ctx.db type is auto-inferred
    return env.ctx.db.findUser(input.id);
  }),
}));
```

### Middleware & Request Context

In `tsdkarc-x`, we clearly separate global singletons injected by DI (`ctx`) from request-level state (`meta`). With built-in type extraction tools (like `MiddlewareExt` / `MiddlewareNextMeta`), you can compose middlewares like building blocks while maintaining strict type safety.

```ts
import { defineMiddleware, MiddlewareExt, MiddlewareNextMeta } from "tsdkarc-x";
import type { ContextOf } from "tsdkarc";
import type { Request } from "express";

// 1. Define base request data (RequestMeta)
export const createContext = async (req: Request) => ({
  get token() {
    return req.header("Authorization")?.replace("Bearer ", "") ?? null;
  },
});
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

// AppCtx is the context type inferred from DI modules, see the DI section
type AppCtx = ContextOf<typeof dbModule> & ContextOf<typeof auditModule>;

// 2. Global middleware: Attach Trace ID
const tracingMw = defineMiddleware<AppCtx, RequestMeta>()(
  async ({ waitUntil }, next) => {
    return next({ traceId: `req_${Date.now()}` }); // New field: traceId
  }
);

// 3. Auth middleware: Parse Token and inject User
const authMw = defineMiddleware<AppCtx, MiddlewareNextMeta<typeof tracingMw>>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer token");
    const user = await ctx.db.findUserByToken(meta.token);
    return next({ user }); // New field: user
  }
);

// 4. Route-level middleware and type inference composition (MiddlewareExt)
// Extract the types "contributed" by authMw and tracingMw, no manual redeclaration needed!
type AuthExt = MiddlewareExt<typeof authMw>; // { user: User }
type AuthExtMeta = MiddlewareNextMeta<typeof authMw>; // { user: User; readonly token: string }
type TracingExt = MiddlewareExt<typeof tracingMw>; // { traceId: string }

// Middleware requiring user info (depends only on AuthExt)
const requireAdminMw = defineMiddleware<AppCtx, AuthExtMeta>()(
  async ({ meta }, next) => {
    if (meta.user.role !== "admin")
      throw new RpcError("FORBIDDEN", "Admin only");
    return next({});
  }
);

// Middleware requiring both user and traceId (composite dependency)
const auditMw = defineMiddleware<AppCtx, AuthExtMeta>()(
  async ({ ctx, meta, waitUntil }, next) => {
    // Run in background, doesn't block the request response
    waitUntil(
      ctx.audit.log("action", { userId: meta.user.id, traceId: meta.traceId })
    );
    return next({});
  }
);

// 5. Apply in routes
export const appRouter = defineRouter({
  modules: [dbModule, auditModule],
  middlewares: [tracingMw, authMw], // Registered globally: all routes automatically get traceId and auth
}).init((r) => ({
  deleteAccount: r
    .use(requireAdminMw) // Add route-level middleware
    .use(auditMw)
    .mutate(z.object({ confirm: z.boolean() }), async (input, env) => {
      // env.meta is strictly typed, containing: token, traceId, user
      return `User ${env.meta.user.id} deleted`;
    }),
}));
```

### Error Handling

Throw a structured `RpcError`. The server automatically maps it to an HTTP status code, and the frontend can narrow the type via `isRpcError`.

```ts
// Server
triggerError: r.query(() => {
  throw new RpcError("NOT_FOUND", "This resource has been deleted.");
});

// Frontend
import { isRpcError } from "tsdkarc-x";

try {
  await client.users.triggerError.query();
} catch (err) {
  if (isRpcError(err)) {
    console.log(err.code, err.message); // "NOT_FOUND"
  }
}
```

### Route Nesting

Just nest objects to build namespaces. The calling path matches the structure strictly.

```ts
// Server
const userRoutes = appRouter.init((r) => ({
  settings: {
    getTheme: r.query(() => "dark_mode"),
  },
}));

// Frontend
await client.users.settings.getTheme.query();
```

### Streaming Response (SSE)

Use `r.stream` combined with `async function*` to push real-time data to frontend.

```ts
// Server
downloadLogs: r.stream(
  z.object({ lines: z.number() }),
  async function* (input) {
    for (let i = 0; i < input.lines; i++) {
      yield { index: i, text: `Log - Line ${i}` };
    }
  }
);

// Frontend
const stream = await client.users.downloadLogs.stream({ lines: 3 });
for await (const chunk of stream) {
  console.log(chunk);
}
```

### File Upload

Use `r.upload` to handle Multipart requests, and `z.coerce` to handle non-string data in the form.

```ts
uploadAvatar: r.upload(
  z.object({
    file: z.instanceof(File),
    cropSize: z.coerce.number(), // Automatically convert FormData string to number
  }),
  async (input) => ({ fileName: input.file.name, size: input.file.size })
);
```

### Background Tasks

Use `env.waitUntil` to register tasks. The response returns immediately while the task keeps running.

```ts
register: r.mutate(z.object({ id: z.string() }), async (input, env) => {
  env.waitUntil(sendEmail(input.id)); // Won't block the response
  return { success: true };
}),

```

### Switching HTTP Frameworks

No need to modify route logic. Just replace the `transport` adapter in `launchApp`.

```ts
import { HonoAdapter } from "tsdkarc-x/hono";

export const app = launchApp({
  basePath: "/api",
  transport: new HonoAdapter({ log: true }), // Switch to Hono
  createContext,
  routes: { users: userRoutes },
  port: 3000,
});
```

Or use `FetchAdapter` in modern Web Standard `Request` / `Response` API frameworks, such as Next.js:

```ts
import { FetchAdapter, toFetchHandler } from "tsdkarc-x/fetch";

export const transport = new FetchAdapter({
  log: true,
});
const app = await launchApp({
  basePath: "/api/arcx",
  transport,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;

// api/arcx/[...paths]/route.ts
const fetchHandler = toFetchHandler(transport);
export const GET = fetchHandler;
export const POST = fetchHandler;
```

### Generating Frontend Types and OpenAPI

Supports exporting types as `.d.ts` or generating OpenAPI docs, perfect for separate frontend/backend repo setups.

```ts
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";
// import { extractOpenApi, extractAppRoutesTypesFull } from "tsdkarc/scripts";

// Generate .d.ts
const { clientDts } = await extractAppRoutesTypesFull(app.routes, {
  entryFile: "./server.ts",
});

// Generate OpenAPI config
const openapi = extractOpenApi(
  app.routes,
  {
    info: { title: "API", version: "1.0.0" },
  },
  { entryFile: "./server.ts" }
);
```

---

## FAQ

**Q: What's the relationship between `tsdkarc-x` and `tsdkarc`?**

`tsdkarc` handles modular dependency injection; `tsdkarc-x` builds the RPC routing layer on top of it. `defineRouter` directly accepts `tsdkarc` modules, and their type inference mechanisms are completely connected.

**Q: What happens if I don't pass a Schema to `r.query` or `r.mutate`?**

The input type falls back to whatever manual type you set for the handler's first parameter. You'll only have static type checking without runtime input validation.

**Q: Does the `stream` handler have to be an `async function*`?**

Yes, `r.stream` relies on Generator's `yield` to push data to the frontend. The frontend uses `for await...of` to consume it, which natively supports incremental semantics.

**Q: Why use `z.coerce.number()` in the upload API?**

Multipart FormData fields are all strings during network transmission. `z.coerce` lets Zod automatically convert them to your target type (like number) during validation, saving you from manual conversions.

**Q: Do I need to change my business route code if I switch to Hono?**

No. You only need to replace `transport` and `createContext` inside `launchApp`. The specific route definitions and middleware logic are completely unaffected.

**Q: How do I use Express middleware with the ExpressAdapter?**

```ts
const transport = new ExpressAdapter();
transport.app.use(cors()); // `app` is the underlying Express application
```

**Q: How do I use Hono middleware with the HonoAdapter?**

```ts
const transport = new HonoAdapter();
transport.app.use(...) // `app` is the underlying Hono application
```

**Q: How do I use `tsdkarc-x` with Web Standard `fetch` frameworks?**

Many modern frameworks support the standard `Request`/`Response` API, including Next.js, Bun, and Deno.

`tsdkarc-x` works with all of them through the `fetch` adapter.

**Bun**

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

const handler = toFetchHandler(transport);

const server = Bun.serve({
  port: 3005,
  fetch(req) {
    if (req.method === "GET") {
      return handler(req);
    }
    if (req.method === "POST") {
      return handler(req);
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Backend listening on http://localhost:${server.port}`);
```

**Deno**

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

const handler = toFetchHandler(transport);

const server = Deno.serve(
  {
    port: 3005,
  },
  (req) => {
    if (req.method === "GET") {
      return handler(req);
    }
    if (req.method === "POST") {
      return handler(req);
    }
    return new Response("Not Found", { status: 404 });
  }
);

console.log(`Backend listening on http://localhost:${server.port}`);
```

**Service Worker**

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

const handler = toFetchHandler(transport);

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method === "GET" || request.method === "POST") {
    event.respondWith(handler(request));
    return;
  }

  event.respondWith(new Response("Not Found", { status: 404 }));
});
```

**Cloudflare Workers**

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

const handler = toFetchHandler(transport);

export default {
  fetch(req: Request) {
    if (req.method === "GET" || req.method === "POST") {
      return handler(req);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

**Q: How do I run `tsdkarc-x` in Next.js?**

See the [Next.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/nextjs-example/).

Or follow these steps:

1. Create `project/app/api/arcx/[...tsdkarc]/route.ts`:

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "project/server/main";

const handler = toFetchHandler(transport);
export const GET = handler;
export const POST = handler;
```

2. Create `project/server/main.ts`:

```ts
// main.ts
import { defineRouter, launchApp, RoutesOf } from "tsdkarc-x";
import { FetchAdapter } from "tsdkarc-x/fetch";

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
export const routes = { users: userRoutes }; // routesExportName

export const transport = new FetchAdapter({
  log: true,
});

const app = await launchApp({
  basePath: "/api/arcx",
  transport,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op and doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;
```

3. Visit `http://localhost:3000/api/arcx/users/health` in your browser. You should see:

```
OK
```

**Q: Why doesn't `tsdkarc-x/scripts` support TS7?**

`tsdkarc-x/scripts` relies on the TypeScript Compiler API. As of now, TS7 does not provide the required API, so `tsdkarc-x/scripts` is not yet compatible with TS7.

This limitation only affects `tsdkarc-x/scripts`; all other features of `tsdkarc-x` work normally.

**Q: What is the relationship between `tsdkarc-x` and `tsdk`?**

`tsdk` was the author's first end-to-end type-safe API toolkit. While it was built around a code generation approach, real-world usage exposed challenges with multi-package distribution and sharing. Those challenges ultimately led to the creation of `tsdkarc`, and later, the more refined `tsdkarc-x`.

Without `tsdk`, there would be no `tsdkarc` or `tsdkarc-x`.

Going forward, development will focus on the `tsdkarc` ecosystem. That said, as the project that started it all, `tsdk` will still receive a proper `1.0` release to bring its journey to a complete close. 🥇

---

## API Reference

### Router Construction

| API                                        | Description                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `defineRouter({ modules, middlewares })`   | Creates `appRouter` instance, accepts modules and global middleware config.    |
| `appRouter.init((r, ctx) => routesObject)` | Defines the route tree, `r` contains `query/mutate/stream/upload/use` methods. |
| `r.use(middleware)`                        | Adds a local middleware to a single route.                                     |
| `defineMiddleware<Ctx, Meta>()(...)`       | Defines a request middleware.                                                  |

### Helper Types

| Type Utility                    | Description                                                                                    | Example Scenario                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ContextOf<typeof module>`      | Extracts the context type after a specific DI module is initialized.                           | `type AppCtx = ContextOf<typeof dbModule>`                                                              |
| `MiddlewareExt<typeof mw>`      | Extracts the object type **newly injected (Ext)** into `meta` by a specific middleware.        | `type AuthExt = MiddlewareExt<typeof authMw>`, which downstream middlewares can use as a generic input. |
| `MiddlewareNextMeta<typeof mw>` | Extracts the **complete** `meta` type passed downstream after this middleware.                 | Used to get a full snapshot type of the request after flowing through a specific node.                  |
| `MiddlewareEnv<Ctx, Meta>`      | Extracts the `env` parameter type (contains `ctx`, `meta`, `waitUntil`, etc.) of a middleware. | Useful when extracting large chunks of middleware logic into standalone plain functions.                |

### Server Running

| API                                                                                                  | Description                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| `launchApp({ ...config })`                                                                           | Starts the HTTP server.        |
| `ExpressAdapter({log?: boolean})` / `HonoAdapter({log?: boolean})` / `FetchAdapter({log?: boolean})` | HTTP framework adapters.       |
| `RpcError(code, message)`                                                                            | Throws a structured exception. |

### Type Utilities

| API                             | Description                                                            |
| ------------------------------- | ---------------------------------------------------------------------- |
| `RoutesOf<typeof app>`          | Extracts full route types for client usage.                            |
| `InferRouteTree<typeof routes>` | Extracts types purely from the route object (no need to start server). |

### Frontend Client

```ts
import { createClient } from "tsdkarc-x/client";

import { createSwrClient } from "tsdkarc-x/react/swr";
import { createReactQueryClient } from "tsdkarc-x/react/query";
import { createVueQueryClient } from "tsdkarc-x/vue/query";
```

| API                                         | Description                                         |
| ------------------------------------------- | --------------------------------------------------- |
| `createClient<AppRoutes>(config)`           | Creates a type-safe client instance.                |
| `isRpcError(err)`                           | Validates and narrows the `RpcError` error type.    |
| `createSwrClient<AppRoutes>(client)`        | Wraps basic client into SWR Hooks.                  |
| `createReactQueryClient<AppRoutes>(client)` | Wraps basic client into React Tanstack Query Hooks. |
| `createVueQueryClient<AppRoutes>(client)`   | Wraps basic client into Vue Tanstack Query Hooks.   |

### Code Generation

| API                              | Description                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `extractAppRoutesTypesFull(...)` | Parses and generates client type declaration files (`.d.ts`). TS 7 not currently supported.    |
| `extractOpenApi(...)`            | Generates OpenAPI spec document object from the route structure. TS 7 not currently supported. |

## Feedback & Issues

If you have any questions or bug reports, feel free to [open an issue](https://github.com/tsdk-monorepo/tsdkarc/issues).
