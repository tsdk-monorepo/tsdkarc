# tsdkarc

> **Decorator-free, type-safe module composition & dependency injection for TypeScript**

tsdkarc keeps your business logic clean from framework code. No decorators, no `reflect-metadata`, no runtime annotations — just plain functions and TypeScript's own inference engine wiring everything together at compile time.

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)

---

## Why tsdkarc?

Most TypeScript DI libraries force you to pollute your code with decorators and manual tokens:

```ts
// ❌ Other frameworks — tight coupling everywhere
@Injectable()
class UserService {
  constructor(@Inject("ILogger") private logger: ILogger) {}
}
```

tsdkarc keeps your code clean:

```ts
// ✅ tsdkarc — plain functions, ctx inferred automatically
import { defineModule } from "tsdkarc";

const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (message: string) => console.log(`[LOG] ${message}`),
}));

const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => ({
  createUser: (name: string) => ctx.logger.log(`Creating user: ${name}`),
}));

const app = await defineModule({ modules: [UserServiceModule] })
  .init()
  .start();
app.ctx.userService.createUser("Alice"); // [LOG] Creating user: Alice
```

**No tokens. No manual bindings. `ctx` is fully inferred from what each module's `init()` returns.**

---

## The Grand Idea: Modules as Reusable Building Blocks

DI in tsdkarc isn't the point — **composability** is. A module is a self-contained, independently testable unit with an explicit dependency list and an explicit output shape. Because nothing is wired by name or token, a module carries no assumptions about which app it lives in.

That means the same module can be:

- **Reused** across multiple apps in the same repo (`LoggerModule` used by both an API server and a CLI tool)
- **Published** as a standalone package and consumed by other projects, with `ctx` still fully typed on the consuming side
- **Swapped** for a different implementation with the same shape, without touching any module that depends on it
- **Composed** into larger modules, which themselves become reusable units — `modules: [...]` nests arbitrarily deep

```ts
// logger-module/index.ts — published independently, zero knowledge of any app
export const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (message: string) => console.log(`[LOG] ${message}`),
}));
```

```ts
// app-a: consumes LoggerModule as-is
const appA = await defineModule({ modules: [LoggerModule, OrderModule] })
  .init()
  .start();
```

```ts
// app-b: same LoggerModule, different composition, still fully typed
const appB = await defineModule({ modules: [LoggerModule, ReportModule] })
  .init()
  .start();
```

A module is regenerable and rewriteable in isolation because its contract — inputs (`modules`), outputs (`init()`'s return value) — is fully declared. Nothing about it depends on where it's mounted.

---

## Features

- **Zero Decorators** — no `@Injectable()`, no `reflect-metadata`, ever
- **Automatic Type Inference** — `ctx` is derived structurally from `init()` return values; no tokens or interface binding required
- **Compile-Time Collision Detection** — overlapping `ctx` keys across modules are caught by the type checker, not at runtime
- **Native Tree Shaking** — no side effects by design; unused modules and type utilities are dropped cleanly by bundlers
- **Full Lifecycle Hooks** — module-level and global-level hooks for boot and graceful shutdown, including automatic rollback on failure
- **Dependency Graph Inspection** — `graph()` + `formatModuleGraph()` give you a printable topology instead of a black box
- **Diamond-Dependency Safe** — shared modules are deduplicated by reference and booted exactly once, regardless of how many paths depend on them

---

## Quick Start

### Installation

```bash
npm install tsdkarc
```

No transformer, no `ts-patch`, no build plugin to configure — `tsdkarc` runs on plain `tsc`/bundler output.

### Basic Usage — It Just Works

```ts
import { defineModule } from "tsdkarc";

// 1. Define your modules (clean code, no decorators!)
const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (message: string) => console.log(`[LOG] ${message}`),
}));

const UserModule = defineModule({ name: "user" }).init(() => {
  const users = [{ id: 1, name: "Alice" }];
  return { findUser: (id: number) => users.find((u) => u.id === id) };
});

// 2. Compose (Composition Root)
const app = await defineModule({
  name: "app",
  modules: [UserModule, LoggerModule],
})
  .init()
  .start();

// 3. Use — ctx type is fully inferred, no resolveType<T>() calls needed
app.ctx.logger.log("started");
console.log(app.ctx.user.findUser(1)?.name); // Alice

// Graceful shutdown
await app.stop();
```

**That's it.** No manual token registration, no `resolveType<T>()` lookups — `app.ctx` is a plain, fully-typed object.

---

## Inference by Structure, Not by Convention

Where token-based DI libraries resolve dependencies by matching a registered type name at runtime, tsdkarc's `ctx` is built purely from the **return values** of `init()`, merged and typed at compile time by TypeScript itself.

```ts
// Anonymous module: return value is spread directly into the parent ctx
const hello = defineModule().init(() => ({ greet: "hello" }));
type HelloCtx = ContextOf<typeof hello>; // { greet: string }

// Named module: return value is namespaced under ctx[name]
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
type ExampleCtx = ContextOf<typeof example>; // { example: { test: string } }
```

Because everything is structural, a class-based service still works fine — you just construct it explicitly inside `init()` instead of relying on decorator metadata:

```ts
class UserService {
  constructor(private logger: ContextOf<typeof LoggerModule>["logger"]) {}
  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}

const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => new UserService(ctx.logger));
```

---

## Wiring Dependencies Between Modules

A module declares what it needs via `modules: [...]`. Inside `init(ctx)`, `ctx` contains only the **dependency** context — never the module's own slice — which is what makes circular self-reference impossible by construction.

```ts
const DatabaseModule = defineModule({
  name: "database",
  modules: [LoggerModule],
}).init((ctx) => new PostgresDatabase(ctx.logger));

const UserServiceModule = defineModule({
  name: "userService",
  modules: [DatabaseModule, LoggerModule], // diamond: LoggerModule appears twice
}).init((ctx) => new UserService(ctx.database, ctx.logger));
```

`LoggerModule` is referenced by two different paths here (`DatabaseModule` and `UserServiceModule`), but tsdkarc deduplicates by module **reference**, not by name — so it boots exactly once, ordered before both of its dependents.

For values that aren't typed modules (env vars, config primitives, secrets), just close over them when defining the module — there's no separate "explicit map" API to learn:

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
  baseUrl: process.env.BASE_URL!,
}));
```

---

## Lifecycle Hooks

tsdkarc ships two tiers of hooks, both `async`-friendly.

**Module-level** (second argument to `.init()`, scoped to that module only):

| Hook                 | `ctx` access                        | When                           |
| -------------------- | ----------------------------------- | ------------------------------ |
| `beforeBoot(depCtx)` | dependency ctx only (not own slice) | before this module initializes |
| `afterBoot`          | dependency ctx + own slice          | after this module initializes  |
| `beforeShutdown`     | dependency ctx + own slice          | before this module tears down  |
| `shutdown`           | dependency ctx + own slice          | core teardown logic            |
| `afterShutdown`      | dependency ctx + own slice          | after this module tears down   |

**Global-level** (argument to `.start()`, scoped to the whole composition):

| Hook                                       | Fires                         | `ctx` state                    |
| ------------------------------------------ | ----------------------------- | ------------------------------ |
| `beforeBoot`                               | before any module boots       | `{}`                           |
| `afterBoot`                                | after all modules boot        | full `FinalCtx`                |
| `beforeEachBoot` / `afterEachBoot`         | around each module's boot     | partial ctx accumulated so far |
| `beforeShutdown` / `afterShutdown`         | around the whole teardown     | full `FinalCtx`                |
| `beforeEachShutdown` / `afterEachShutdown` | around each module's teardown | full `FinalCtx`                |

`*Each*` hooks also receive `meta: { name: string | null; kind: "named" | "anon" }`.

If boot fails partway through, tsdkarc automatically rolls back already-started modules in reverse dependency order, calling their `shutdown` hook with the failure as `reason` — no manual cleanup bookkeeping required.

---

## Dependency Graph Inspection

No black-box resolution — the composed graph is data you can print.

```ts
import { formatModuleGraph } from "tsdkarc";

console.log(formatModuleGraph(app.graph()));
// - app
//   - userService
//     - database
//       - logger
//     - logger
```

Also the first place to look when debugging a `[tsdkarc] Circular dependency detected at module "<name>"` error.

---

## Real-World Example

```ts
import { defineModule } from "tsdkarc";
import type { ContextOf } from "tsdkarc";

const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string, error?: Error) =>
    console.error(`[ERROR] ${message}`, error),
}));

type Logger = ContextOf<typeof LoggerModule>["logger"];

class PostgresDatabase {
  constructor(private logger: Logger) {}
  async query<T>(sql: string) {
    this.logger.info(`Executing query: ${sql}`);
    return [] as T[];
  }
}

const DatabaseModule = defineModule({
  name: "database",
  modules: [LoggerModule],
}).init((ctx) => new PostgresDatabase(ctx.logger));

type Database = ContextOf<typeof DatabaseModule>["database"];

class UserService {
  constructor(private database: Database, private logger: Logger) {}
  async getUser(id: number) {
    this.logger.info(`Fetching user ${id}`);
    return this.database.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}

const UserServiceModule = defineModule({
  name: "userService",
  modules: [DatabaseModule, LoggerModule],
}).init((ctx) => new UserService(ctx.database, ctx.logger));

const app = await defineModule({
  name: "app",
  modules: [UserServiceModule],
})
  .init()
  .start({
    afterBoot: (ctx) => console.log("app ready:", Object.keys(ctx)),
  });

await app.ctx.userService.getUser(123);
await app.stop();
```

**Notice:**

- Every service is plain TypeScript — `PostgresDatabase` and `UserService` know nothing about tsdkarc.
- Wiring happens once, in the module definitions — there's no separate registration step to keep in sync.
- Testing is trivial: `new UserService(mockDatabase, mockLogger)`, no container required.

---

## Why No Decorators?

### Business logic should not know about the DI framework

```ts
// ❌ BAD — coupled to the framework
@Injectable()
class OrderService {
  constructor(@Inject("Logger") private logger: ILogger) {}
}

// ✅ GOOD — plain class, framework-agnostic
class OrderService {
  constructor(private logger: Logger) {}
}
```

`OrderService` can be constructed and unit-tested with zero knowledge that tsdkarc exists. Wiring lives entirely in the module definition, which is the only file that imports `tsdkarc`.

### Composition Root

All composition happens in one place — the top-level `defineModule({ modules: [...] })` call — the same way NovaDI centralizes registration in a `Container`/`builder`. Everywhere else stays plain TypeScript.

---

## API Reference

### `defineModule(meta?)`

Returns a `ModuleDeclaration`.

| Parameter         | Type          | Description                                                                |
| ----------------- | ------------- | -------------------------------------------------------------------------- |
| `name`            | `string`      | optional. Namespace key for this module's slice in `ctx`                   |
| `modules`         | `AnyModule[]` | optional. Modules this module depends on                                   |
| `ignoreConflicts` | `string[]`    | optional. Keys allowed to collide across modules (deep-merged, later wins) |

### Module instance methods

| Method                   | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `.init(bootFn?, hooks?)` | instantiate, returns a `NamedModule` or `AnonModule`  |
| `.with(...modules)`      | shorthand for composing modules (`.init().with(...)`) |
| `.start(options?)`       | boot the composition, returns `{ ctx, stop }`         |
| `.graph()`               | returns the `ModuleGraphNode` dependency tree         |

### Type utilities

| Type            | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `ContextOf<M>`  | full `ctx` type after a module has booted                    |
| `DepCtxOf<M>`   | this module's dependency `ctx` type (excludes its own slice) |
| `OwnSliceOf<M>` | this module's own `init()` return type                       |

---

## Comparison

|                                 | tsdkarc                                    | Decorator-based DI (NestJS / InversifyJS) |
| ------------------------------- | ------------------------------------------ | ----------------------------------------- |
| Decorators required             | ❌                                         | ✅                                        |
| `reflect-metadata` required     | ❌                                         | ✅ (usually)                              |
| Build-time transformer required | ❌                                         | varies                                    |
| `ctx` typing                    | fully inferred from `init()` return        | manual interface/token binding            |
| Collision detection             | compile-time (`FindSliceCollision`)        | runtime, if at all                        |
| Diamond dependencies            | deduplicated by reference automatically    | depends on container implementation       |
| Dependency graph inspection     | built-in `graph()` / `formatModuleGraph()` | varies                                    |

---

## FAQ

**Q: How is this different from NestJS / InversifyJS?**

No `reflect-metadata`, no `@Injectable()`. TypeScript's own type inference derives `ctx` automatically from what `init()` returns.

**Q: What happens on a circular dependency?**

`.start()` throws immediately during the sort phase: `[tsdkarc] Circular dependency detected at module "<name>"`. Use `.graph()` + `formatModuleGraph()` to find it.

**Q: A module's `init()` return collides with an injected dependency key — what happens?**

A compile-time `FindSliceCollision` error. This is a static check only — bypassing it with `@ts-ignore` causes a silent runtime overwrite.

**Q: Do diamond dependencies boot twice?**

No. Modules are deduplicated by object reference (not by `name`) during topological sort, so a shared module boots exactly once, ordered before everything that depends on it.

**Q: An anonymous module's fields collide with another module's — what happens?**

Runtime throws `[tsdkarc] Anonymous module slice collision`, unless the field is explicitly listed in `ignoreConflicts`.

**Q: How does the `ignoreConflicts` merge work?**

Deep merge (later overrides earlier) only when both sides are plain objects — arrays, `Date`, `Map`, and class instances are replaced wholesale, never merged or concatenated. `__proto__` and `prototype` are always skipped for safety.

---

## Repository Layout

```text
tsdkarc/       # core library
tsdkarc-x/     # official extended ecosystem: end-to-end type-safe dev framework
tsdkbundle/    # monitoring & bundling tooling
website/       # documentation site
```

---

## Contributing

Issues and pull requests welcome.

## License & Changelog

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- License: [MIT](./LICENSE)

---

**Keep your `ctx` inferred. Keep your modules plain. Use tsdkarc.**
