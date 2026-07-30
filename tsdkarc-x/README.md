# tsdkarc-x

Fast, type-safe RPC for full-stack TypeScript.

---

## Design

- **No Side Effects** — Middlewares never mutate `ctx`. Data flows down via `next({ ... })`.
- **Snowball Inference** — Each middleware widens the downstream type automatically.
- **Transport-Agnostic** — Handlers program against a typed `ctx`, unaware of Hono, Express, or Edge runtimes.

---

## API Reference

### 1. `defineMiddleware`

Curried factory that fixes the input contract in the first call and receives the handler in the second.

```
defineMiddleware<TInCtx>()(handler)
```

| Parameter   | Description                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `TInCtx`    | Input contract. The middleware can only mount where this shape is satisfied. |
| `ctx`       | Accumulated context: `BaseCtx` + DI modules + upstream injections.           |
| `next(ext)` | Passes control downstream, merging `ext` into the context.                   |

```typescript
type BaseCtx = Awaited<ReturnType<typeof createContext>>;

// Basic auth
const authMw = defineMiddleware<BaseCtx>()(async (ctx, next) => {
  if (!ctx.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
  return next({ user: { id: "u_1", role: "admin" } });
});

// Requires authMw to have already injected `user`
const requireAdminMw = defineMiddleware<{ user: { role: string } }>()(
  async (ctx, next) => {
    if (ctx.user.role !== "admin")
      throw new RpcError("FORBIDDEN", "Admin only.");
    return next({ isAdmin: true });
  }
);
```

---

### 2. `defineRouter`

Composes typed **Route Blueprints**. No side effects until `.init()` is called.

**`defineRouter({ modules?, middlewares? })`** — Creates a base blueprint.

**`.extend({ modules?, middlewares? })`** — Derives a child blueprint, inheriting all modules and middlewares.

**`.init(factory)`** — Instantiates the blueprint into a mountable `RouteFactoryTree`.

```
factory(r, ctx) => Record<string, RouteEndpoint>
```

| Param | Description                                                       |
| ----- | ----------------------------------------------------------------- |
| `r`   | Route builder (see methods below).                                |
| `ctx` | Resolved DI dependencies, typed from the blueprint's module list. |

#### Route Builder (`r`)

| Method                       | Transport           | Notes                                                          |
| ---------------------------- | ------------------- | -------------------------------------------------------------- |
| `r.query(schema?, handler)`  | GET                 | Read-only.                                                     |
| `r.mutate(schema?, handler)` | POST / PUT          | State-mutating.                                                |
| `r.stream(schema?, handler)` | SSE                 | Handler must be `async function*`.                             |
| `r.upload(schema?, handler)` | multipart/form-data | File uploads.                                                  |
| `r.use(middleware)`          | —                   | Returns a new `r` — chain before `.query()`, `.mutate()`, etc. |

#### Handler Signature: `(input, env)`

| Param              | Description                              |
| ------------------ | ---------------------------------------- |
| `input`            | Validated input from `schema`.           |
| `env.ctx`          | DI dependencies.                         |
| `env.meta`         | All upstream middleware injections.      |
| `env.waitUntil(p)` | Non-blocking background task, Edge-safe. |

```typescript
import { z } from "zod";

// Base blueprint
export const appRouter = defineRouter({
  modules: [dbModule, emailModule],
  middlewares: [
    defineMiddleware<BaseCtx>()(async (ctx, next) =>
      next({ traceId: `req_${Date.now()}` })
    ),
  ],
});

// Protected blueprint — inherits everything, adds auth
export const protectedRouter = appRouter.extend({
  middlewares: [
    defineMiddleware<BaseCtx>()(async (ctx, next) => {
      if (!ctx.token) throw new RpcError("UNAUTHORIZED", "Missing Token");
      const user = await ctx.db.findUser(ctx.token);
      return next({ user });
    }),
  ],
});

// Route handlers
export const userRoutes = protectedRouter.init((r, ctx) => ({
  updateProfile: r.mutate(
    z.object({ name: z.string() }),
    async (input, env) => {
      await env.ctx.db.updateUser(env.meta.user.id, input.name);
      env.waitUntil(env.ctx.email.sendAlert(`Profile updated: ${input.name}`));
      return { success: true };
    }
  ),

  deleteAccount: r.use(verifyMfaMw).mutate(z.void(), async (_, env) => {
    if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
    return "Deleted";
  }),
}));
```

---

### 3. `launchApp`

Binds the RPC engine to an HTTP transport and starts the server.

```typescript
launchApp({ basePath, transport, createContext, routes, port });
```

| Option               | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| `basePath`           | URL prefix (e.g. `"/api"`).                                                         |
| `transport`          | Adapter instance — `new HonoAdapter()`, `new ExpressAdapter()`, etc.                |
| `createContext(req)` | Converts the raw request into a clean `BaseCtx`. The only transport-aware boundary. |
| `routes`             | `RouteFactoryTree` — supports arbitrary nesting.                                    |
| `port`               | Defaults to `3000`.                                                                 |

**Returns:** `Promise<{ stop, routes }>`

| Property | Description                                                                 |
| -------- | --------------------------------------------------------------------------- |
| `stop()` | Closes the server, then tears down DI modules in reverse topological order. |
| `routes` | Used to extract `RoutesOf<typeof app>` for the frontend.                    |

**Boot sequence:** collect DI modules → topological sort & boot → bind transport → listen.

```typescript
import { launchApp, type RoutesOf } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express-adapter";

const app = launchApp({
  basePath: "/api",
  transport: new ExpressAdapter(),
  createContext: async (req) => ({
    get token() {
      return req.header("Authorization") || null;
    },
  }),
  routes: { v1: { users: userRoutes, ai: aiRoutes } },
  port: 8080,
});

export type AppRoutes = RoutesOf<typeof app>;

app.then(({ stop }) => {
  process.on("SIGINT", async () => {
    await stop();
    process.exit(0);
  });
});
```

---

### 4. Client

```typescript
import { createClient } from "tsdkarc-x/client";
import { createSwrClient } from "tsdkarc-x/react/swr";
import { createQueryClient } from "tsdkarc-x/react/query";
import type { AppRoutes } from "tsdkarc-x";

const api = createClient<AppRoutes>({ url: "http://localhost:8080/api" });

const profile = await api.v1.users.getProfile.query({ id: "123" });
console.log(profile.name); // fully typed

await api.v1.users.deleteAccount.mutate();
```

---

## Error Handling

Throw `RpcError` in any middleware or handler:

```typescript
import { RpcError } from "tsdkarc";

throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
throw new RpcError("FORBIDDEN", "Admin only.");
throw new RpcError("NOT_FOUND", "User not found.");
```

The client receives the code and message as a structured error.
