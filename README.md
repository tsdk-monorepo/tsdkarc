# tsdkarc

<a href="https://arc.tsdk.dev">
<img src="./assets/banner.jpg" width="100%" style="border-radius: 24px" alt="tsdkarc: theElegant, fully type-safe module composition library" /></a>

---

<div align="center">
The elegant, fully type-safe module composition library.
</div>

---

```bash
npm install tsdkarc
```

## Why

Application codebases grow, the code become coupled and messy — hard to reuse, hard to share.
`tsdkarc` lets you compose modules like building blocks, nest them, and share them across projects.

In **tsdkrc**, Each module declares what it needs and what it provides. Then call `start([modules])` will resolves the full dependency graph, boots modules in order, and returns a typed context.

## Quick Start

```ts
import start, { defineModule } from "tsdkarc";

import start, { defineModule } from "tsdkarc";

interface ConfigSlice {
  config: { port: number; env: string };
}

const configModule = defineModule<ConfigSlice>()({
  name: "config",
  modules: [],
  boot(ctx) {
    ctx.set("config", {
      env: process.env.NODE_ENV ?? "development",
      port: Number(process.env.PORT) || 3000,
    });
  },
});

// Run
(async () => {
  const app = await start([configModule]);
  console.log(app.ctx.config.port); // 3000
  await app.stop();
})();
```

---

## Core Concepts

| Term        | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Slice**   | The shape a module adds to the shared context (`{ key: Type }`)                                 |
| **Module**  | Declares dependencies (`modules`), registers values (`ctx.set`), and optionally tears them down |
| **Context** | The merged union of all slices — fully typed at each module's boundary                          |

---

## API Outline

```ts
defineModule<OwnSlice>()({
  name: string,
  modules: Module[],
  boot?(ctx): void | Promise<void>,
  beforeBoot?(ctx): void | Promise<void>,
  afterBoot?(ctx): void | Promise<void>,
  shutdown?(ctx): void | Promise<void>,
  beforeShutdown?(ctx): void | Promise<void>,
  afterShutdown?(ctx): void | Promise<void>,
})

start(modules: Module[], hooks?: {
  beforeBoot?(ctx): void | Promise<void>,
  afterBoot?(ctx): void | Promise<void>,
  beforeShutdown?(ctx): void | Promise<void>,
  afterShutdown?(ctx): void | Promise<void>,
}): Promise<{ ctx, stop() }>
```

| Hook             | When it runs                                         |
| ---------------- | ---------------------------------------------------- |
| `beforeBoot`     | before all module's `boot`                           |
| `boot`           | register values via `ctx.set(key, value)`            |
| `afterBoot`      | after all modules have booted (e.g. start listening) |
| `shutdown`       | begin teardown — runs in reverse boot order          |
| `beforeShutdown` | before all module's `shutdown`                       |
| `afterShutdown`  | after all module's `shutdown` completes              |

---

## Dependency Chain

Downstream modules declare upstream modules and get their context fully typed.

```ts
interface DbSlice {
  db: Pool;
}

const dbModule = defineModule<DbSlice>()({
  name: "db",
  modules: [configModule], // ctx.config is typed here
  async boot(ctx) {
    const pool = new Pool({ connectionString: ctx.config.databaseUrl });
    await pool.connect();
    ctx.set("db", pool);
  },
  async shutdown(ctx) {
    await ctx.db.end();
  },
});

interface ServerSlice {
  server: http.Server;
}

const serverModule = defineModule<ServerSlice>()({
  name: "server",
  modules: [configModule, dbModule], // ctx.config + ctx.db both typed
  boot(ctx) {
    ctx.set("server", http.createServer(myHandler));
  },
  afterBoot(ctx) {
    ctx.server.listen(ctx.config.port);
  },
  shutdown(ctx) {
    ctx.server.close();
  },
});

const app = await start([serverModule]);
// app.ctx = ConfigSlice & DbSlice & ServerSlice
await app.stop();
```

`start()` walks the dependency graph and deduplicates — each module boots exactly once regardless of how many times it appears in `modules` arrays.

---

## Global Hooks

Use the second argument to `start()` for process-level concerns that need access to the full context.

```ts
const app = await start([serverModule], {
  afterBoot(ctx) {
    process.on("uncaughtException", (err) => ctx.logger.error(err));
  },
  beforeShutdown(ctx) {
    ctx.logger.info("shutting down");
  },
});
```

---

## Patterns

**Register anything, not just data.** Functions, class instances, and middleware are all valid context values.

```ts
interface AuthSlice {
  authenticate: (req: Request, res: Response, next: NextFunction) => void;
}

const authModule = defineModule<AuthSlice>()({
  name: "auth",
  modules: [],
  boot(ctx) {
    ctx.set("authenticate", (req, res, next) => {
      if (!req.headers.authorization) return res.status(401).end();
      next();
    });
  },
});
```

**Compose small modules.** Each module is independently testable and replaceable. Complex wiring is just a chain of dependencies.

```ts
// config → db → cache → queue → server
const app = await start([serverModule]);
```

---

## Lifecycle

```
beforeBoot → boot → afterBoot → [running] → beforeShutdown → shutdown → afterShutdown
```

| Hook             | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `beforeBoot`     | Pre-setup, before `ctx.set()` calls        |
| `boot`           | Register values on `ctx` via `ctx.set()`   |
| `afterBoot`      | All modules booted, cross-module ctx ready |
| `beforeShutdown` | Prepare for teardown                       |
| `shutdown`       | Release resources                          |
| `afterShutdown`  | Final cleanup                              |

---

## API

### `defineModule<Slice>()(config)`

| Field            | Type                       | Description                   |
| ---------------- | -------------------------- | ----------------------------- |
| `name`           | `string`                   | Unique module identifier      |
| `description`    | `string`                   | Optional description          |
| `modules`        | `Module[]`                 | Declared dependencies         |
| `beforeBoot`     | `(ctx) => void \| Promise` | Runs before boot              |
| `boot`           | `(ctx) => void \| Promise` | Register values on ctx        |
| `afterBoot`      | `(ctx) => void \| Promise` | Runs after all modules booted |
| `beforeShutdown` | `(ctx) => void \| Promise` | Runs before shutdown          |
| `shutdown`       | `(ctx) => void \| Promise` | Release resources             |
| `afterShutdown`  | `(ctx) => void \| Promise` | Runs after shutdown           |

### `start(roots, options?)` → `{ ctx, stop }`

| Field     | Description                            |
| --------- | -------------------------------------- |
| `roots`   | Top-level modules (deps auto-resolved) |
| `options` | Global lifecycle hooks + custom logger |
| `ctx`     | Merged, fully-typed context            |
| `stop`    | Triggers full shutdown sequence        |

## Projects You May Also Be Interested In

- [xior](https://github.com/suhaotian/xior) - A tiny but powerful fetch wrapper with plugins support and axios-like API
- [tsdk](https://github.com/tsdk-monorepo/tsdk) - Type-safe API development CLI tool for TypeScript projects
- [broad-infinite-list](https://github.com/suhaotian/broad-infinite-list) - ⚡ High performance and Bidirectional infinite scrolling list component for React and Vue3
- [littkk](https://github.com/suhaotian/littkk) - 🧞‍♂️ Shows and hides UI elements on scroll.

## Reporting Issues

Found an issue? Please feel free to [create issue](https://github.com/tsdk-monorepo/tsdkarc/issues/new)

## Support

If you find this project helpful, consider [buying me a coffee](https://github.com/tsdk-monorepo/tsdkarc/stargazers).
