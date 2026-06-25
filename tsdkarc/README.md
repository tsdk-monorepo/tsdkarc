# <a href="https://arc.tsdk.dev" align="center"><img src="../assets/logo.jpg" align="center" width="30px" height="30px" style="border-radius: 4px;margin-right:4px;" alt="TsdkArc: The elegant module composable library and it's type-safe!" /></a> TsdkArc

<a href="https://arc.tsdk.dev">
<img src="../assets/banner.jpg" width="100%" style="border-radius: 24px" alt="TsdkArc: The elegant module composable library and it's type-safe!" /></a>

<div align="center">The elegant module composable library and it's type-safe!
</div>

---

[![npm version](https://img.shields.io/npm/v/tsdkarc.svg?style=flat)](https://www.npmjs.com/package/tsdkarc) [![Size](https://deno.bundlejs.com/badge?q=tsdkarc&config={%22esbuild%22:{%22external%22:[%22react%22,%22react-dom%22,%22react/jsx-runtime%22]}})](https://bundlejs.com/?q=tsdkarc&treeshake=%5B%7Bdefault,defineModule%7D%5D&config=%7B%22esbuild%22:%7B%22external%22:%5B%22react%22,%22react-dom%22,%22react/jsx-runtime%22%5D%7D%7D) ![0 dependencies](https://img.shields.io/badge/0-dependencies!-brightgreen) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/suhaotian/tsdkarc/pulls) [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/suhaotian/tsdkarc/blob/main/LICENSE) [![jsDocs.io](https://img.shields.io/badge/jsDocs.io-reference-blue)](https://www.jsdocs.io/package/tsdkarc) ![typescript](https://badgen.net/badge/icon/typescript?icon=typescript&label&color=blue)

The elegant module composable library and it's type-safe!

## 💡 API Quick Reference

**`defineModule({ name?, modules?, ignoreConflicts? })`**

- **`name`** _(Optional)_: The namespace where the module's output will be mounted in the context (e.g., `"user"` → `ctx.user`). If omitted, the initialization result is merged directly into the top-level `ctx`.
- **`modules`** _(Optional)_: An array of dependent modules (supports both named and anonymous modules). Duplicate keys are not allowed and will trigger a type error.
- **`ignoreConflicts`** _(Optional, ideal for custom frameworks)_: A list of top-level `ctx` keys that allow multiple modules to contribute values. These keys undergo **deep merging** at runtime, and type checking skips conflict detection for them (allowing for type intersections).

**`.init(initFn?, hooks?)`**

- **`initFn(ctx)`**: The core factory function. It receives the dependency context and can return a synchronous object or a Promise.
- **`hooks`** _(Optional)_: Lifecycle hooks for the module (all optional):
  - `beforeBoot(ctx)` — Triggered before module initialization.
  - `afterBoot(ctx)` — Triggered after module initialization.
  - `beforeShutdown(ctx, reason?)` — Triggered before the shutdown logic starts.
  - `shutdown(ctx, reason?)` — The main logic to safely release resources.
  - `afterShutdown(ctx, reason?)` — Triggered after the shutdown logic completes.

**`.start(options?)`**
Starts the module tree and returns `{ ctx, stop }`.

- Can be called directly on `defineModule(...)` without needing to call `.init()` first.
- **`options`** supports global lifecycle hooks:
  `beforeBoot`, `afterBoot`, `beforeShutdown`, `afterShutdown`, `beforeEachBoot`, `afterEachBoot`, `beforeEachShutdown`, `afterEachShutdown`.

**`.with(...modules)`**

- Composes the current module with other sibling modules (duplicate keys are disallowed and will throw a type error).
- Can be called directly on `defineModule(...)` without calling `.init()` first.

---

## ⚙️ Core Workflow & Rollback

1. **Resolve**: Flattens all composed modules and dependency trees, then performs a topological sort. If circular dependencies are detected, an error is thrown immediately.
2. **Boot**: Executes strictly according to the dependency order: `beforeBoot` -> `initFn` -> merge context -> `afterBoot`.
3. **Rollback**: If any module throws an exception during the boot phase (e.g., inside `initFn`), the system immediately halts the boot process. It then calls the `shutdown` hooks of all successfully started modules in **reverse order** to safely release resources, and finally throws the original error.
4. **Shutdown**: When `stop(reason?: string | Error | unknown)` is called manually, the system executes the shutdown hooks in the **exact opposite order** (LIFO) of their startup sequence, ensuring dependents are closed before their dependencies.

---

## 🔀 Deep Merge — `ignoreConflicts`

For keys declared in `ignoreConflicts`, the runtime rules are as follows:

- If the key does not yet exist in `ctx`: Assign it directly.
- If the key exists in `ctx` and both values are plain objects: Perform a **recursive deep merge** (the later module overrides conflicting leaf nodes).
- If either side is not a plain object: **The later module overwrites the previous one**.

---

## 📖 Typical Examples

### 1. Basic Dependency Injection (Named & Anonymous Modules)

```typescript
// dbModule: Named module, output will be mounted to ctx.db
const dbModule = defineModule({ name: "db" }).init(() => {
  return { client: new DatabaseConnection() };
});

// userModule: Depends on dbModule
const userModule = defineModule({
  name: "user",
  modules: [dbModule],
}).init((ctx) => {
  // ctx.db.client is completely type-safe!
  return { repo: new UserRepository(ctx.db.client) };
});
```

### 2. Lifecycle & Graceful Degradation (Hooks & Shutdown)

```typescript
const redisModule = defineModule({ name: "redis" }).init(
  async () => {
    const client = await createRedisClient();
    return { client };
  },
  {
    // Triggered automatically when stop() is called, or when another module crashes during boot causing a rollback
    shutdown: async (ctx, reason) => {
      console.log(`Closing Redis due to: ${reason}`);
      await ctx.client.quit();
    },
  }
);
```

### 3. Plugin-style Deep Merge & Type Intersection (Composer Decides)

Sub-modules don't need to worry about conflicts; the "Composer" (parent module) declares `ignoreConflicts`. This not only achieves a deep merge at runtime but also creates perfect type `Intersection` at the TypeScript level.

```typescript
const authRouteModule = defineModule().init(() => ({
  routes: { "/login": () => {} },
}));

const userRouteModule = defineModule().init(() => ({
  routes: { "/profile": () => {} },
}));

// Composed module: The parent module takes over conflict resolution, allowing `routes` to merge
const appModule = defineModule({ ignoreConflicts: ["routes"] }).with(
  authRouteModule,
  userRouteModule
);

// Perfect inference! typeOfModule contains the complete intersection type:
// { routes: { "/login": () => void; "/profile": () => void; } }
type typeOfModule = ContextOf<typeof appModule>;

const { ctx } = await appModule.start();
// ctx.routes evaluates to: { "/login": [Function], "/profile": [Function] }
```

### 4. Composition & Startup (Compose & Start)

```typescript
const rootModule = defineModule().with(userModule, redisModule);

// Start the entire module tree
const { ctx, stop } = await rootModule.start({
  beforeEachBoot: (ctx, mod) => console.log(`Starting ${mod.name}...`),
});

// Graceful exit
process.on("SIGTERM", async () => {
  await stop("SIGTERM received");
  process.exit(0);
});
```

## Projects You May Also Be Interested In

- [xior](https://github.com/suhaotian/xior) - A tiny but powerful fetch wrapper with plugins support and axios-like API
- [tsdk](https://github.com/tsdk-monorepo/tsdk) - Type-safe API development CLI tool for TypeScript projects
- [broad-infinite-list](https://github.com/suhaotian/broad-infinite-list) - ⚡ High performance and Bidirectional infinite scrolling list component for React and Vue3
- [littkk](https://github.com/suhaotian/littkk) - 🧞‍♂️ Shows and hides UI elements on scroll.

## Reporting Issues

Found an issue? Please feel free to [create issue](https://github.com/tsdk-monorepo/tsdkarc/issues/new)

## Support

If you find this project helpful, consider [buying me a coffee](https://github.com/tsdk-monorepo/tsdkarc/stargazers).
