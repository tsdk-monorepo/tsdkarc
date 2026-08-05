# Documentation for tsdkarc, tsdkarc-x and tsdkbundle

Instructions for an AI agent generating/modifying code in this repo (`tsdkarc` DI, `tsdkarc-x` RPC, `tsdkbundle` build). All code is LLM-generated and LLM-regenerated. This file is the single source of truth for this repo; where it conflicts with your own training knowledge of similar libraries (tRPC, NestJS, InversifyJS, etc.), follow this file — `tsdkarc`/`tsdkarc-x` are not those libraries and don't share their conventions.

- **tsdkarc** README: https://github.com/tsdk-monorepo/tsdkarc/blob/main/README.md
- **tsdkarc-x** README: https://github.com/tsdk-monorepo/tsdkarc-x/blob/main/README.md
- **tsdkbundle** README: https://github.com/tsdk-monorepo/tsdkarc/blob/main/README.md

---

## Setup commands

- Install: `npm install tsdkarc tsdkarc-x tsdkbundle`
- Dev server: `bb dev`
- Build: `bb build`

## Pinned versions

latest

> For openapi and static types generating features, require TypeScript above 5 and below 7.

## Before declaring a task done

- Run a typecheck (`tsc --noEmit` or equivalent) on touched files.
- If a `tsdkarc` module graph was touched, mentally (or actually) re-run `.graph()` — check for new circular dependencies or field collisions before finishing.
- Do not run or invent a test command until Setup Commands above is filled in.

## Restricted / generated files

- Never hand-edit output of `extractAppRoutesTypesFull` (generated `.d.ts` client types) or `extractOpenApi` (generated OpenAPI JSON) — regenerate from source instead.
- Never hand-edit `dist/` or any `outdir` configured in `bundle.config.ts`.

---

## 0. Rules (in priority order — higher wins on conflict)

1. Never guess an import path or export name not listed in §2. If a needed export isn't listed, say so instead of inventing a path.
2. §5 (architecture directives) governs all `tsdkarc-x` backend code. §4 (DI mechanics) and §0 defer to §5 when they conflict.
3. Full-file rewrite over patch-edit unless the change is a single line.
4. No hidden state, no side effects not visible in the function signature.
5. `/** ... */` doc comment on every exported function/class: purpose + non-obvious invariants only. Never restate an inferable return type (no `: void`, no `: number`, no `: Promise<T>` if inference already gives it).
6. Structured, actionable errors/logs at every module boundary (DI `init`, route handler, adapter call).
7. After generating or editing DI-graph code, mentally re-run `.graph()` — if a new circular dependency or field collision is plausible, say so before finishing.

---

## 1. Source ambiguities — flag, do not silently resolve

These are contradictions found _inside the project's own README files_. Do not pick one arbitrarily and present it as fact — surface the ambiguity to the user, or default to the more specific subpath form and say you did so.

| Symbol                                            | Conflict                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createReactQueryClient` / `createVueQueryClient` | One README section aliases them (`import { createReactQueryClient } from "tsdkarc-x/react/query"`); another section imports them as if that's the literal export name.                                                                                                                           |
| `extractOpenApi` / `extractAppRoutesTypesFull`    | Three different import paths appear across the doc (`tsdkarc-x/openapi` + `tsdkarc-x/extract`, vs. a commented alternate `tsdkarc/scripts`, vs. FAQ text `tsdkarc-x/scripts`). Use `tsdkarc-x/openapi` and `tsdkarc-x/extract` — they're the ones shown in working code, not comments/FAQ prose. |
| `defineMiddleware` handler signature              | One example destructures an env object (`async ({ ctx, meta, waitUntil }, next)`); another passes raw `ctx` as the first arg. Use the destructured env-object form — it matches the `MiddlewareEnv<Ctx, Meta>` type helper and the fuller worked example.                                        |

---

## 2. Canonical imports

```ts
// tsdkarc
import {
  defineModule,
  type ContextOf,
  type DepCtxOf,
  type OwnSliceOf,
} from "tsdkarc";

// tsdkarc-x — main entry
import {
  defineRouter,
  launchApp,
  type RoutesOf,
  type InferRouteTree,
  defineMiddleware,
  type MiddlewareExt,
  type MiddlewareNextMeta,
  type MiddlewareEnv,
  RpcError,
  isRpcError,
} from "tsdkarc-x";

// transports (subpath-confirmed)
import { ExpressAdapter } from "tsdkarc-x/express";
import { HonoAdapter } from "tsdkarc-x/hono";
import { FetchAdapter, toFetchHandler } from "tsdkarc-x/fetch"; // toFetchHandler required for Bun/Deno/Workers/Next.js/Service Worker

// client
import { createClient } from "tsdkarc-x/client";
import { createSwrClient } from "tsdkarc-x/react/swr";
import { createReactQueryClient } from "tsdkarc-x/react/query";
import { createVueQueryClient } from "tsdkarc-x/vue/query";

// codegen (TS6 only, not TS7-compatible)
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";
// or
// import { extractOpenApi, extractAppRoutesTypesFull } from "tsdkarc-x/script";
```

`RpcError` codes:

```ts
export type RpcErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";
```

---

## 3. tsdkarc — DI API surface

- `defineModule({ name?, modules?, ignoreConflicts? })`
- `.init(bootFn?, hooks?)` — `hooks` = `{ beforeBoot?, shutdown?, ... }` lifecycle callbacks for this module.
- `.with(...modules)` — add dependency modules after declaration (dynamic composition).
- `.start(options?)` — boots the tree; `options` can carry global lifecycle hooks.
- `.graph()` → `{ formatted, ... }` dependency tree, for debugging.
- `.stop()` — reverse-order shutdown.
- Anonymous module (no `name`) → return value flattens into parent `ctx`.
- Named module → mounts at `ctx[name]`.
- Non-module values (env vars, secrets) — close over them inside `init()`, no injection API exists for these.

**Failure modes:**

- Circular dependency → throws at `.start()`. Run `.graph()` to locate the cycle.
- Named-module field collision → compile-time `FindSliceCollision`. Do not `@ts-ignore` — the collision still exists at runtime and the later-loaded module silently overwrites the field. Rename instead.
- Anonymous-module field collision → runtime `[tsdkarc] Anonymous module slice collision`. Intentional merges go in `ignoreConflicts: string[]`; only plain objects deep-merge, `Array`/`Date`/`Map`/class instances are replaced wholesale.

---

## 4. tsdkarc-x — RPC API surface

- `defineRouter({ modules?, middlewares? })` — accepts `tsdkarc` modules directly.
- `.init((r, ctx) => routesObject)` — `r` = `{ query, mutate, stream, upload, use }`.
- `launchApp({ basePath, transport, createContext?, routes, port })`.
- `RoutesOf<typeof app>` — always extract client types from `launchApp`'s return, never from `defineRouter`.
- `InferRouteTree<typeof routes>` — extract types from a raw route object without starting the server.
- `r.query(schema?, handler)` / `r.mutate(schema?, handler)` — schema optional; omitting it drops runtime validation, static type falls back to the handler's declared input type.
- `r.upload(schema, handler)` — multipart fields arrive as strings; use `z.coerce.number()` / `z.coerce.boolean()`.
- `r.stream(schema, handler)` — handler MUST be `async function*`; client consumes with `for await...of`.
- `r.use(middleware)` — route-level middleware.
- `defineMiddleware<Ctx, Meta>()(async (env, next) => next({ ...newFields }))` where `env = { ctx, meta, waitUntil }` (see §1 for signature-style note).
- `MiddlewareExt<typeof mw>` — fields a middleware adds. `MiddlewareNextMeta<typeof mw>` — full meta after it runs. `MiddlewareEnv<Ctx, Meta>` — the `env` param type, for extracting middleware logic into standalone functions.
- `env.waitUntil(promise)` — background task, doesn't block the response. (Source docs give no guarantee about task completion if the process/runtime exits first — do not assume this is durable across serverless/edge invocations unless the target adapter documents it.)
- `throw new RpcError(code, message)` server-side → auto-mapped to HTTP status (mapping table not published in source — don't assume specific status codes without checking the adapter). `isRpcError(err)` narrows client-side.
- Transports: `ExpressAdapter`, `HonoAdapter`, `FetchAdapter`. Swapping `transport` in `launchApp` is the only change needed to switch frameworks.

**One canonical wiring** (module → service → router → middleware → launch → client → hook):

```ts
// db.module.ts
import { defineModule, type ContextOf } from "tsdkarc";
const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
}));
type AppCtx = ContextOf<typeof dbModule>;

// user.service.ts
class UserService {
  constructor(private db: AppCtx["db"]) {}
  getProfile(id: string) {
    return this.db.findUser(id);
  }
}

// middleware.ts
import { defineMiddleware, RpcError } from "tsdkarc-x";
const authMw = defineMiddleware<AppCtx, { token: string | null }>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer token");
    return next({ user: ctx.db.findUser("from-token") });
  }
);

// user.router.ts
import { defineRouter } from "tsdkarc-x";
import { z } from "zod";
const appRouter = defineRouter({ modules: [dbModule], middlewares: [] });
const userRoutes = appRouter.init((r, ctx) => ({
  getProfile: r
    .use(authMw)
    .query(z.object({ id: z.string() }), async (input, env) => {
      return new UserService(env.ctx.db).getProfile(input.id);
    }),
}));

// app.ts
import { launchApp, type RoutesOf } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express";
export const app = await launchApp({
  basePath: "/api",
  transport: new ExpressAdapter({ log: true }),
  routes: { users: userRoutes },
  port: 3000,
});
export type AppRoutes = RoutesOf<typeof app>;

// client.ts
import { createClient } from "tsdkarc-x/client";
import { createReactQueryClient } from "tsdkarc-x/react/query";
import type { AppRoutes } from "./app";
const client = createClient<AppRoutes>({
  baseURL: "http://localhost:3000/api",
});
export const hooks = createReactQueryClient<AppRoutes>(client);
// hooks.users.getProfile.useQuery({ id: "u_1" })
```

---

## 5. Architecture directives — mandatory for all `tsdkarc-x` backend code

1. No decorators.
2. Domain logic in plain `class`es; dependencies injected via constructor only.
3. Inject the concrete infra type via `ContextOf<typeof infraModule>` directly — no redundant interfaces.
4. No `process.env` inside reusable components. Each defines a Zod `ConfigSchema`; its factory (`createXxxComponent(options)`) takes `config` explicitly, validates fail-fast (throw synchronously in the factory on invalid config).
5. `defineModule` is glue only: pull deps from `ctx`, `new Service(config, ctx.db)`, return the instance. No business logic in `.module.ts` files.
6. Route handlers never touch the DB or contain business logic — one service-method call, return its result.
7. Zod schemas live in `xxx.schema.ts`, not inline in the router.
8. Client type extraction is always `RoutesOf<typeof app>`.
9. `r.stream` handlers are always `async function*`; numeric/boolean fields in `r.upload`/`r.query` always use `z.coerce`.

**File structure:**

```
src/
 ├── core/                      # host infra (e.g. db.module.ts)
 ├── domains/<name>/
 │    ├── <name>.config.ts      # Zod config schema
 │    ├── <name>.schema.ts      # RPC request/response Zod schemas
 │    ├── <name>.service.ts     # pure class, ContextOf<typeof dbModule>
 │    ├── <name>.module.ts      # factory: { config, dbModule } -> Service
 │    └── <name>.router.ts      # thin routes
 ├── app.ts                     # env -> config + DB adapter -> launchApp
 └── client.ts                  # RoutesOf<typeof app>-derived client
```

---

## 6. tsdkbundle

```ts
import type { BundleConfigFn, BundleConfig } from "tsdkbundle";
export default (({ command }): BundleConfig => ({
  default: ["backend"],
  projects: {
    backend: {
      target: "node", // "node" | "browser" | "bun"
      entry: ["src/index.ts"], // one or more independently-compiled entries
      main: "src/index.ts", // dev-mode spawned process; defaults to entry[0]
      external: ["pg", "bcrypt"], // never bundle native/node-only packages
      outdir: "dist",
      sourcemap: command === "build" ? "none" : "linked",
      minify: command === "build",
    },
  },
})) satisfies BundleConfigFn;
```

CLI: `bundle dev [project]`, `bundle build [project]` (use `bb` if `bundle` collides with Ruby's bundler). Not an HMR tool — backend entries only; use Vite/Next.js for frontend.

---

## 7. Task → action lookup

| Task                   | Action                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| New domain feature     | Create `domains/<name>/` per §5 structure; register module in `app.ts`.                                                        |
| New infra dependency   | Extend a `core/` module; export its `ContextOf<typeof mod>` slice — no wrapper interface.                                      |
| Authenticated route    | `defineMiddleware` chain, attach via `r.use(...)`; read `env.meta.user` only in the handler; logic stays in the service class. |
| Background side effect | `env.waitUntil(...)` in the handler; don't block the response; don't assume durability (§4).                                   |
| Switch HTTP framework  | Change only `transport` in `launchApp`.                                                                                        |
| New standalone script  | Add to `entry` in `bundle.config.ts`; set `main` only if it's the dev-spawned process.                                         |
| Debug startup failure  | Print `app.graph().formatted` before looking elsewhere.                                                                        |
| Unlisted task          | Match the closest §5 pattern, state the assumption made, proceed — don't block on it.                                          |
