# tsdkarc

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml/badge.svg)](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml)

🇺🇸 English · [🇨🇳 中文](./README.zh-CN.md)

## Introduction

tsdkarc is a module composition and Dependency Injection (DI) library for TypeScript.

Its core design uses no decorators and does not rely on `reflect-metadata`. The module context (`ctx`) is inferred entirely at compile time from the return value of each module's `init()` method. The output is pure JavaScript code, requiring no extra AST tools or special compile configs.

## What Problems Does It Solve?

1. **No runtime "black magic" or overhead**: Traditional DI relies heavily on decorators and reflection, causing large bundle sizes and breaking tree-shaking. **tsdkarc** uses pure function calls, making it completely transparent to modern build tools.
2. **Catch dependency errors early**: Missing dependencies or typo errors usually crash the app at startup. **tsdkarc** moves dependency graph checks to the TS compile time. Any context type mismatch will fail the type check immediately.
3. **Handles diamond dependencies automatically**: In complex projects, multiple business features might depend on the same base module (like logs or config). **tsdkarc** uses object references for topological sorting and deduplication, ensuring shared dependencies start in the right order and only once.
4. **Reliable resource cleanup**: It includes global and module-level lifecycle management. If any module fails during startup, it automatically runs the cleanup logic for started modules in reverse order.

## Quick Start

**Installation**

Install directly via npm. It works with standard `tsc` or any bundler:

```bash
npm install tsdkarc@next

```

**Basic Usage**

Define modules and assemble them explicitly:

```ts
import { defineModule, type ContextOf } from "tsdkarc";

// 1. Define a base module
const LoggerModule = defineModule().init(() => {
  return {
    logger: {
      log: (message: string) => console.log(`[LOG] ${message}`),
    },
  };
});

// Extract the inferred type for external use
type ILogger = ContextOf<typeof LoggerModule>["logger"];

class UserService {
  constructor(private logger: ILogger) {}
  createUser(name: string) {
    this.logger.log(`Creating user: ${name}`);
  }
}

// 2. Define a business module and declare dependencies
const UserServiceModule = defineModule({
  name: "userService",
  modules: [LoggerModule],
}).init((ctx) => new UserService(ctx.logger));

// 3. Assemble and start the app
const app = await defineModule({ modules: [UserServiceModule, LoggerModule] })
  .init((ctx) => {
    ctx.logger.log("Application started");
  })
  .start();
app.ctx.userService.createUser("Alice");
await app.stop();
```

## Common Examples

### Named vs Anonymous Modules

The return values of anonymous modules are flattened and merged into the parent. Named modules are mounted under a namespace using their `name` as the key.

```ts
// Anonymous module
const hello = defineModule().init(() => ({ greet: "hello" }));
// ctx is inferred as: { greet: string }

// Named module
const example = defineModule({ name: "example" }).init(() => ({ test: "x" }));
// ctx is inferred as: { example: { test: string } }
```

### Injecting Non-Module Variables (e.g., Env Vars)

No special injection API is needed. Just access them directly inside the `init` closure:

```ts
const ConfigModule = defineModule({ name: "config" }).init(() => ({
  apiKey: process.env.API_KEY!,
}));
```

### Viewing the Dependency Tree

When debugging dependency issues, you can print the formatted dependency graph:

```ts
console.log(app.graph().formatted);
/* 
- app
  - userService
    - logger 
*/
```

## FAQ

**What happens if there is a circular dependency?**

`.start()` will throw an error during the sorting phase before startup: `[tsdkarc] Circular dependency detected at module "<name>"`. You can print `.graph()` to locate the circular loop.

**What happens if a module's exposed field name conflicts with a dependency's field name?**

It will trigger a `FindSliceCollision` type error at compile time. Note: if you force bypass it using `@ts-ignore`, the module loaded later will overwrite the earlier one at runtime.

**What if field names conflict between anonymous modules?**

A `[tsdkarc] Anonymous module slice collision` error will be thrown at runtime. If you really need to merge fields with the same name, explicitly declare them using the `ignoreConflicts` array when defining the module.

**How are fields declared in ignoreConflicts merged?**

Deep merging is only performed if both conflicting fields are plain objects. Arrays, `Date` objects, `Map`s, or class instances will be completely replaced.

**What is the relationship between tsdkarc-x and tsdkarc?**

tsdkarc-x depends on the core features of tsdkarc. Also, [`tsdkarc-x`](https://npmjs.com/package/tsdkarc-x) is an end-to-end (backend to frontend) type-safe development library built on top of tsdkarc.

## API Reference

### `defineModule(meta?)`

Used to declare a module. Returns a `ModuleDeclaration` object.

| Parameter         | Type          | Description                                                                      |
| ----------------- | ------------- | -------------------------------------------------------------------------------- |
| `name`            | `string`      | Optional. The namespace key for this module in the context.                      |
| `modules`         | `AnyModule[]` | Optional. Declares other modules that this module depends on.                    |
| `ignoreConflicts` | `string[]`    | Optional. A list of keys that are allowed to conflict and will be deeply merged. |

### Instance Methods

- `.init(bootFn?, hooks?)`: Defines the module's initialization logic and lifecycle hooks (like `beforeBoot`, `shutdown`, etc.).
- `.with(...modules)`: Dynamically adds dependency modules.
- `.start(options?)`: Starts the entire module tree. You can pass global lifecycle hooks.
- `.stop()`: Stops all modules in the reverse order of their dependencies.
- `.graph()`: Returns the dependency tree data and its formatted output.

### Type Helpers

- `ContextOf<M>`: Extracts the full context type of a module.
- `DepCtxOf<M>`: Extracts the context type the module depends on (excluding itself).
- `OwnSliceOf<M>`: Extracts the type of the return value from the module's own `init()` method.
