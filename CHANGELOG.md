# TsdkArc Packages Changelog

## tsdkarc@2.0.0

- Publish tsdkarc@2.0.0 from alpha version

## tsdkarc-x@0.1.7

- Fix client's stream not working on browser
- Add enabled option to useQuery to swr hooks
- Add e2e tests for `swr` / `@tanstack/react-query` / `@tanstack/vue-query` hooks

## tsdkarc-x@0.1.6

- Support `defineRouter()` no need pass `{}` as `defineRouter({})`
- Update README

## tsdkarc-x@0.1.5

- Fix empty middleware type issue
- Update README

## tsdkarc-x@0.1.3

- Improve middleware type

## tsdkarc-x@0.1.2, tsdkarc@2.0.0-alpha.2, tsdkbundle@0.0.2

- Fix esm bundle output(need `.js` ext for vite)

## tsdkarc-x@0.1.1

- Fix `tsdkarc-x/esm` not build

## tsdkarc-x@0.1.0

- Breaking⚠️: Refactor the middleware implementation with better DX
- Add `"tsdkarc/scripts"' exports
- Add Tanstack example

```ts
import { extractOpenApi, extractAppRoutesTypesFull } from "tsdkarc/scripts";
```

## tsdkarc-x@0.0.4

- Add `fetch-adapter` to support Next.js

## tsdkarc@v2.0.0-alpha.1

- Add `graph()` method to `module.start({})`'s return

## tsdkarc-x@0.0.3

- Add `{log?: boolean}` option to `ExpressAdapter` and `HonoAdapter`
- Add `license` to package.json

## tsdkarc-x@0.0.2

- Add @tanstack/vue-query generated support
- Add examples(express / hono)
- Update README

## tsdkarc@v2.0.0-alpha.0

⚠️ Breaking change.

The API has been completely redesigned. 🚀

Check the new README: https://github.com/tsdk-monorepo/tsdkarc/

## v1.3.0

- Add `defineUnit` helper, `defineUnit` is a wrapper of `defineModule` but has more convenient API
- Add more helper types and utils

---

**Example**: With `defineUnit`:

```ts
import { defineUnit } from "tsdkarc";

const configModule = defineUnit()({
  name: "config",
  boot: () => ({ config: { url: "postgres://localhost" } }),
});

const dbModule = defineUnit({ modules: [configModule] })({
  name: "db",
  boot: (ctx) => ({ db: { url: ctx.config.url } }),
});

const modA = defineUnit()({ name: "modA", boot: () => ({ a: 1 }) });
const dbModule2 = dbModule.add([modA]);
```

**Example**: Before without `defineUnit` and use original `defineModule`:

```ts
import { defineModule } from "tsdkarc";

const configModule = defineModule()({
  name: "config",
  boot: () => ({ config: { url: "postgres://localhost" } }),
});

const dbModule = defineModule()({
  name: "db",
  modules: [configModule] as const,
  boot: (ctx) => ({ db: { url: ctx.config.url } }),
});

const modA = defineModule()({ name: "modA", boot: () => ({ a: 1 }) });

// no .add() in raw defineModule — manually declare deps
const dbModule2 = defineModule()({
  name: "db2",
  modules: [dbModule, modA] as const,
});
```

## v1.2.3

- Fix `ctx`'s `set` should only keep in `boot` hook

## v1.2.2

- Fix `ctx`'s type are any on hooks
- Chore: Delete useless code

## v1.2.1

- Fix `SetOf` not exists

## v1.2.0

- Feat: New unified type helpers: `ContextOf<Module>` / `ContextWritterOf<Module>` / `SetOf<Module>`
- Feat: More smart `boot` return Ctx type infers! 🍻
- Breaking Change: `InferContextBy<Module>` -> `ContextOf<Module>`
- Breaking Change: `ContextWriterBy<Module>` -> `ContextWritterOf<Module>`

## v1.1.5

- Feat: add helper type `ContextWriterBy` to get `set` of `typeof module`

## v1.1.4

- Feat: improve the helper type `InferContextBy` directly infer type from **nested** modules

## v1.1.3

- Feat: add helper type `InferContextBy` directly infer type from the module

## v1.1.2

- Fix `mod.beforeShutdown` and `mod.afterShutdown` running logic

## v1.1.1

- Fix type issue with conflict context types
- Add more tests

## v1.1.0

`boot` support return `ctx` object 🚀 Thank you [@prehensilemullet's comment](https://www.reddit.com/r/node/comments/1rwnoz7/comment/ob2d9p4/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button)

## v1.0.1

Improve docs and Minor improvement

## v1.0.0

publish first version 🥂
