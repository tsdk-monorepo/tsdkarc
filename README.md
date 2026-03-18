# <a href="https://arc.tsdk.dev" align="center"><img src="./assets/logo.jpg" align="center" width="30px" height="30px" style="border-radius: 4px;margin-right:4px;" alt="TsdkArc: the Elegant, fully type-safe module composable library" /></a> TsdkArc

<a href="https://arc.tsdk.dev">
<img src="./assets/banner.jpg" width="100%" style="border-radius: 24px" alt="TsdkArc: the Elegant, fully type-safe module composable library" /></a>

<div align="center">The Elegant, Fully Type-safe Module Composable Library.
</div>

---

[![npm version](https://img.shields.io/npm/v/tsdkarc.svg?style=flat)](https://www.npmjs.com/package/tsdkarc) [![Size](https://deno.bundlejs.com/badge?q=tsdkarc&config={%22esbuild%22:{%22external%22:[%22react%22,%22react-dom%22,%22react/jsx-runtime%22]}})](https://bundlejs.com/?q=tsdkarc&treeshake=%5B%7Blittkk%7D%5D&config=%7B%22esbuild%22:%7B%22external%22:%5B%22react%22,%22react-dom%22,%22react/jsx-runtime%22%5D%7D%7D) ![0 dependencies](https://img.shields.io/badge/0-dependencies!-brightgreen) [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/suhaotian/tsdkarc/pulls) [![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/suhaotian/tsdkarc/blob/main/LICENSE) [![jsDocs.io](https://img.shields.io/badge/jsDocs.io-reference-blue)](https://www.jsdocs.io/package/tsdkarc) ![typescript](https://badgen.net/badge/icon/typescript?icon=typescript&label&color=blue)

## Why `TsdkArc`

Your application codebases grow, the code become coupled and messy — hard to reuse, hard to share.
`TsdkArc` lets you compose modules like building blocks, nest them, and share them type safely across projects.

In **tsdkarc**, Each module declares what it needs and what it provides. Then call `start([modules])` will resolves the full dependency graph, boots modules in order, and returns a typed context.

## Quick Start

```bash
npm install tsdkarc
```

```ts
import start, { defineModule } from "tsdkarc";

interface ConfigSlice {
  config: { port: number; env: string };
}

const configModule = defineModule<ConfigSlice>()({
  name: "config",
  modules: [],
  boot(ctx) {
    return {
      config: {
        env: process.env.NODE_ENV ?? "development",
        port: Number(process.env.PORT) || 3000,
      },
    };
    // Or:
    /* 
      ctx.set("config", {
        env: process.env.NODE_ENV ?? "development",
        port: Number(process.env.PORT) || 3000,
      });
    */
  },
});

// Run
(async () => {
  const app = await start([serverModule], {
    afterBoot() {
      console.log("The app is running");
    },
    onError(error, ctx, mod) {
      console.log(`${mod.name} error`, error.message);
      // throw error;
    },
  });
  console.log(app.ctx.config.port); // 3000
  await app.stop();
})();
```

- Online Playground: [Do some practice here](https://stackblitz.com/edit/vitejs-vite-kdennssf?file=src%2FB.module.ts,src%2FA.module.ts,src%2Ftsdkarc-demo.ts,src%2FC.module.ts,src%2Fcircular-dependencies.module.ts&terminal=dev)
- Website & Documentation: https://arc.tsdk.dev/

---

## Core Concepts

| Term        | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **Slice**   | The shape a module adds to the shared context (`{ key: Type }`)                                 |
| **Module**  | Declares dependencies (`modules`), registers values (`ctx.set`), and optionally tears them down |
| **Context** | The merged union of all slices — fully typed at each module's boundary                          |

## API Outline

```ts
defineModule<OwnSlice>()({
  name: string,
  modules: Module[],
  boot?(ctx): OwnSlice | Promise<OwnSlice> | void | Promise<void>,
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

  beforeEachBoot?(ctx): void | Promise<void>,
  afterEachBoot?(ctx): void | Promise<void>,
  beforeEachShutdown?(ctx): void | Promise<void>,
  afterEachShutdown?(ctx): void | Promise<void>,

  onError?(error: Error, ctx, mod): void | Promise<void>,
}): Promise<{ ctx, stop() }>
```

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
await app.stop();
```

`start()` walks the dependency graph and deduplicates — each module boots exactly once regardless of how many times it appears in `modules` arrays.

---

## Global Hooks

Use the second argument to `start()` for process-level concerns that need access to the full context.

```ts
const app = await start([serverModule], {
  afterBoot(ctx) {
    process.on("uncaughtException", (err) => console.error(err));
  },
  beforeShutdown(ctx) {
    console.info("shutting down");
  },
  afterEachBoot(ctx) {
    console.info("booting", mod.name);
  },
  beforeEachShutdown(ctx, mod) {
    console.info("shutting down", mod.name);
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

| Hook                 | Purpose                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `beforeBoot`         | Pre-setup, Called once before the first module begins booting.                 |
| `boot`               | Register values on `ctx` via return ctx or call `ctx.set()`                    |
| `afterBoot`          | Called once after the last module has finished booting.                        |
| `beforeShutdown`     | Called once before the first module begins shutting down.                      |
| `shutdown`           | Release resources                                                              |
| `afterShutdown`      | Called once after the last module has finished shutting down.                  |
| `beforeEachBoot`     | Called before each individual module boots, in boot order.                     |
| `afterEachBoot`      | Called after each individual module finishes booting, in boot order.           |
| `beforeEachShutdown` | Called before each individual module shuts down, in shutdown order.            |
| `afterEachShutdown`  | Called after each individual module finishes shutting down, in shutdown order. |

---

## API

### `defineModule<Slice>()(config)`

| Field            | Type                       | Description                   |
| ---------------- | -------------------------- | ----------------------------- |
| `name`           | `string`                   | Unique module identifier      |
| `description`    | `string`                   | Optional description          |
| `modules`        | `Module<Slice>[]`          | Declared dependencies         |
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
| `options` | Global lifecycle hooks                 |
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
