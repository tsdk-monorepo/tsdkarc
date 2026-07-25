# tsdkarc

> **Decorator-free, type-safe module composition & dependency injection for TypeScript**

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)

🇺🇸 English · [🇨🇳 中文](./README.zh-CN.md)

No decorators, no `reflect-metadata`. `ctx` is fully inferred at compile time from each module's `init()` return value.

```ts
import { defineModule, type ContextOf } from "tsdkarc";

const LoggerModule = defineModule().init(() => {
  console.log("[LOG] init LoggerModule"); // Only log once: [LOG] init LoggerModule
  return {
    logger: {
      log: (message: string) => console.log(`[LOG] ${message}`),
    },
  };
});

type ILogger = ContextOf<typeof LoggerModule>["logger"];

class UserService {
  constructor(private logger: ILogger) {}
  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}

const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => new UserService(ctx.logger));

const app = await defineModule({ modules: [UserServiceModule, LoggerModule] })
  .init((ctx) => {
    ctx.logger.log("The application is running..."); // [LOG] The application is running...
  })
  .start();
app.ctx.userService.createUser("Alice"); // [LOG] Creating user: Alice
await app.stop();
```

---

## The Grand Idea: Modules as Reusable Building Blocks

DI isn't the point — **composability** is. A module's contract is fully declared by itself: `modules` is its input, `init()`'s return value is its output. It has no idea which app it will be mounted into, so it can be reused across projects, published standalone, swapped wholesale, or nested into larger modules.

```ts
// logger-module/index.ts — published independently, no app-specific knowledge
export const LoggerModule = defineModule({ name: "logger" }).init(() => ({
  log: (message: string) => console.log(`[LOG] ${message}`),
}));

// Different apps reuse the same module, ctx stays fully typed
const appA = await defineModule({ modules: [LoggerModule, OrderModule] })
  .init()
  .start();
const appB = await defineModule({ modules: [LoggerModule, ReportModule] })
  .init()
  .start();
```

---

## Features

- **Zero decorators** — no `reflect-metadata`
- **Automatic type inference** — `ctx` derived structurally from `init()` return values, no tokens
- **Compile-time collision detection** — duplicate keys fail type-checking
- **Native tree shaking** — no side effects by design
- **Full lifecycle hooks** — module-level and global, automatic rollback in reverse dependency order on boot failure
- **Dependency graph inspection** — `graph()`
- **Diamond-dependency safe** — deduplicated by reference, shared modules boot exactly once

---

## Install

```bash
npm install tsdkarc
```

No transformer, no `ts-patch` — runs on plain `tsc`/bundler output.

---

## Defining & Composing Modules

```ts
// Anonymous module: return value is spread directly into the parent ctx
const hello = defineModule().init(() => ({ greet: "hello" }));
type HelloCtx = ContextOf<typeof hello>; // { greet: string }

// Named module: return value is namespaced under ctx[name]
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
type ExampleCtx = ContextOf<typeof example>; // { example: { test: string } }
```

`init(ctx)` only receives the **dependency** context, never its own slice — which is why circular self-reference is structurally impossible. For non-module values like env vars or secrets, just close over them inside `init()` — no separate "explicit map" API needed:

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
}));
```

**Diamond dependencies**: if `LoggerModule` is depended on by multiple paths, tsdkarc deduplicates by module reference (not `name`), booting it exactly once, ordered before all of its dependents.

---

## Lifecycle Hooks

**Module-level** (second argument to `.init()`, scoped to that module): `beforeBoot` `afterBoot` `beforeShutdown` `shutdown` `afterShutdown`

**Global-level** (argument to `.start()`, scoped to the whole composition): `beforeBoot` `afterBoot` `beforeEachBoot` `afterEachBoot` `beforeShutdown` `afterShutdown` `beforeEachShutdown` `afterEachShutdown`

`*Each*` hooks also receive `meta: { name: string | null; kind: "named" | "anon" }`. On boot failure, already-started modules automatically roll back their `shutdown` in reverse dependency order — no manual cleanup required.

---

## Dependency Graph

```ts
console.log(app.graph().formatted);
// - app
//   - userService
//     - logger
```

The first place to check when debugging `[tsdkarc] Circular dependency detected at module "<name>"`.

---

## API Reference

**`defineModule(meta?)`** → `ModuleDeclaration`

| Parameter         | Type          | Description                                      |
| ----------------- | ------------- | ------------------------------------------------ |
| `name`            | `string`      | optional, ctx namespace key                      |
| `modules`         | `AnyModule[]` | optional, modules this one depends on            |
| `ignoreConflicts` | `string[]`    | optional, keys allowed to collide and deep-merge |

**Module instance methods**: `.init(bootFn?, hooks?)` · `.with(...modules)` · `.start(options?)` · `.graph()`

**Type utilities**: `ContextOf<M>` full ctx type · `DepCtxOf<M>` dependency ctx type (excludes own slice) · `OwnSliceOf<M>` own `init()` return type

---

## FAQ

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
tsdkarc-x/     # official extended ecosystem
tsdkbundle/    # monitoring & bundling tooling
website/       # documentation site
```

---

## License

[MIT](./LICENSE)

[CHANGELOG.md](./CHANGELOG.md)
