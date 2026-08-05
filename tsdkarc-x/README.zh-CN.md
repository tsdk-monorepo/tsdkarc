# tsdkarc-x

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Built on tsdkarc](https://img.shields.io/badge/built%20on-tsdkarc-orange.svg)](https://www.npmjs.com/package/tsdkarc)
[![CI](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml/badge.svg)](https://github.com/tsdk-monorepo/tsdkarc/actions/workflows/ci.yml)

🇨🇳 中文 · [🇺🇸 English](./README.md)

## 介绍

`tsdkarc-x` 是一个基于 `tsdkarc` 的端到端类型安全 RPC 框架。通过它，你在服务端编写路由后，前端客户端可以直接获取对应的请求类型，调用方法和 React/Vue hooks。

---

## 为什么或者解决了什么痛点

1. **前后端类型断层**：前端无需手动定义接口类型，也无需依赖额外的代码生成步骤。服务端的入参和返回值类型会自动推导到前端调用端。
2. **校验与类型重复定义**：通过集成 Zod，在服务端实现运行时校验的同时，直接利用 Schema 推导出静态类型（可选），保持运行与静态类型一致。
3. **上下文与依赖管理混乱**：基于 `tsdkarc` 的类型安全 DI 模块系统，自动推导数据库、全局中间件和请求级上下文的类型，避免到处传递 `any` 或手动断言。
4. **框架强绑定**：路由与业务逻辑同底层 HTTP 框架（如 Express、Hono）解耦，切换框架时无需修改业务代码。

---

## Examples

- [Next.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/nextjs-example/)
- [Minimal Express.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/minimal-express/)
- [Minimal Hono.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/minimal-hono/)

Want more examples? [Request one](https://github.com/tsdk-monorepo/tsdkarc/issues).

---

## 快速运行

### 1. 安装依赖

```bash
npm install tsdkarc-x tsdkarc zod
# npm install express multer @types/multer @types/express @scalar/express-api-reference
# npm install hono @hono/node-server @scalar/hono-api-reference
```

> > 注意：请根据你的适配器需求，安装所需的 HTTP 框架，例如 `express`、`hono`，或者任何支持 Web Standard `fetch` 并实现 `Request` / `Response` API 的框架。

### 2. 服务端：定义路由并启动服务

使用 **Bun**:

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

使用 **Express.js**:

```ts
// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express";

// 1. 创建路由实例
const appRouter = defineRouter({});

// 2. 定义具体路由
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new ExpressAdapter();
// 3. 启动服务
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3000,
});

// 4. 导出路由类型供前端使用
export type AppRoutes = RoutesOf<typeof app>;

// 测试
await fetch("http://localhost:3000/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });
```

### 2.1 生成 opeanpi 接口文档

```ts
// ...previous code

import { extractOpenApi } from "tsdkarc-x/openapi"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { apiReference } from "@scalar/express-api-reference";
import fs from "fs/promises";
import path from "path";

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
    // Put your OpenAPI url here:
    url: `http://localhost:3000/api/openapi`,
  })
);
```

### 2.2 导出接口静态类型，方便分发

```ts
// ...previous code

// 生成静态类型文件
const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
  app.routes,
  {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  }
);
// 写入静态文件
await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
]);
```

### 3. 前端：创建客户端并发起调用

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

const health = await client.users.health.query(); // "OK"，并且享有完整的自动补全和类型提示

// const swrHooks = createSwrClient<AppRoutes>(client); // React swr hooks
// swrHooks.users.health.useQuery()
// const reactQueryHooks = createReactQueryClient<AppRoutes>(client); // React tanstack query hooks
// const vueQueryHooks = createVueQueryClient<AppRoutes>(client); // Vue tanstack query hooks
```

---

## 常用示例

### 入参校验 (Zod Schema)

使用 `r.query` 或 `r.mutate` 时，传入 Zod Schema 即可实现自动校验与类型推导。

```ts
const userRoutes = appRouter.init((r) => ({
  // 查询操作
  getProfile: r.query(
    z.object({ includeHistory: z.boolean().default(false) }),
    async (input) => {
      return { id: "u_1", history: input.includeHistory ? [] : null };
    }
  ),
  // 写操作
  updateTheme: r.mutate(
    z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
    (input) => `Theme changed to ${input.theme}`
  ),
}));
```

### 依赖注入 (DI)

复用 `tsdkarc` 模块系统，注入数据库等依赖，类型自动传递到 handler 中。

```ts
import { defineModule } from "tsdkarc";

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
}));

export const appRouter = defineRouter({
  modules: [dbModule], // 注册依赖
});

const userRoutes = appRouter.init((r) => ({
  getProfile: r.query(z.object({ id: z.string() }), async (input, env) => {
    // env.ctx.db 类型自动推导
    return env.ctx.db.findUser(input.id);
  }),
}));
```

### 中间件与请求上下文

在 `tsdkarc-x` 中，我们将依赖注入的全局实例（`ctx`）与请求级别的状态（`meta`）做了明确区分。通过搭配内置的类型提取工具（如 `MiddlewareExt` / `MiddlewareNextMeta`），你可以像搭积木一样组合中间件，并保持严格的类型安全。

```ts
import { defineMiddleware, MiddlewareExt, MiddlewareNextMeta } from "tsdkarc-x";
import type { ContextOf } from "tsdkarc";
import type { Request } from "express";

// 1. 定义基础请求数据 (RequestMeta)
export const createContext = async (req: Request) => ({
  get token() {
    return req.header("Authorization")?.replace("Bearer ", "") ?? null;
  },
});
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;

// AppCtx 是由 DI 模块推导出的上下文类型，见 DI 章节
type AppCtx = ContextOf<typeof dbModule> & ContextOf<typeof auditModule>;

// 2. 全局中间件：附加 Trace ID
const tracingMw = defineMiddleware<AppCtx, RequestMeta>()(
  async ({ waitUntil }, next) => {
    return next({ traceId: `req_${Date.now()}` }); // 新增字段：traceId
  }
);

// 3. 鉴权中间件：解析 Token 并注入 User
const authMw = defineMiddleware<AppCtx, MiddlewareNextMeta<typeof tracingMw>>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token) throw new RpcError("UNAUTHORIZED", "Missing Bearer token");
    const user = await ctx.db.findUserByToken(meta.token);
    return next({ user }); // 新增字段：user
  }
);

// 4. 路由级中间件与类型推导组合 (MiddlewareExt)
// 提取 authMw 和 tracingMw 所“贡献”的类型，无需手动重新声明！
type AuthExt = MiddlewareExt<typeof authMw>; // { user: User }
type AuthExtMeta = MiddlewareNextMeta<typeof authMw>; // { user: User; readonly token: string }
type TracingExt = MiddlewareExt<typeof tracingMw>; // { traceId: string }

// 需要 user 信息的中间件（仅依赖 AuthExt）
const requireAdminMw = defineMiddleware<AppCtx, AuthExtMeta>()(
  async ({ meta }, next) => {
    if (meta.user.role !== "admin")
      throw new RpcError("FORBIDDEN", "Admin only");
    return next({});
  }
);

// 需要 user 且需要 traceId 的中间件（组合依赖）
const auditMw = defineMiddleware<AppCtx, AuthExtMeta>()(
  async ({ ctx, meta, waitUntil }, next) => {
    // 放入后台执行，不阻塞请求响应
    waitUntil(
      ctx.audit.log("action", { userId: meta.user.id, traceId: meta.traceId })
    );
    return next({});
  }
);

// 5. 在路由中应用
export const appRouter = defineRouter({
  modules: [dbModule, auditModule],
  middlewares: [tracingMw, authMw], // 全局注册：所有路由自带 traceId 和 auth
}).init((r) => ({
  deleteAccount: r
    .use(requireAdminMw) // 路由级附加中间件
    .use(auditMw)
    .mutate(z.object({ confirm: z.boolean() }), async (input, env) => {
      // env.meta 拥有严格的强类型，包含：token, traceId, user
      return `User ${env.meta.user.id} deleted`;
    }),
}));
```

### 错误处理

抛出结构化的 `RpcError`，服务端会自动映射为 HTTP 状态码，前端可通过 `isRpcError` 收窄类型。

```ts
// 服务端
triggerError: r.query(() => {
  throw new RpcError("NOT_FOUND", "This resource has been deleted.");
});

// 前端
import { isRpcError } from "tsdkarc-x";

try {
  await client.users.triggerError.query();
} catch (err) {
  if (isRpcError(err)) {
    console.log(err.code, err.message); // "NOT_FOUND"
  }
}
```

### 路由嵌套

直接在对象中嵌套即可构建命名空间，调用路径与结构严格一致。

```ts
// 服务端
const userRoutes = appRouter.init((r) => ({
  settings: {
    getTheme: r.query(() => "dark_mode"),
  },
}));

// 前端
await client.users.settings.getTheme.query();
```

### 流式响应 (SSE)

使用 `r.stream` 并结合 `async function*`，实现服务端向前端实时推送数据。

```ts
// 服务端
downloadLogs: r.stream(
  z.object({ lines: z.number() }),
  async function* (input) {
    for (let i = 0; i < input.lines; i++) {
      yield { index: i, text: `Log - Line ${i}` };
    }
  }
);

// 前端
const stream = await client.users.downloadLogs.stream({ lines: 3 });
for await (const chunk of stream) {
  console.log(chunk);
}
```

### 文件上传

使用 `r.upload` 处理 Multipart 请求，并利用 `z.coerce` 处理表单中的非字符串数据。

```ts
uploadAvatar: r.upload(
  z.object({
    file: z.instanceof(File),
    cropSize: z.coerce.number(), // 自动将 FormData 字符串转为 number
  }),
  async (input) => ({ fileName: input.file.name, size: input.file.size })
);
```

### 后台任务

使用 `env.waitUntil` 注册任务，响应会立即返回，后台任务继续执行。

```ts
register: r.mutate(z.object({ id: z.string() }), async (input, env) => {
  env.waitUntil(sendEmail(input.id)); // 不阻塞响应
  return { success: true };
}),

```

### 切换底层 HTTP 框架

无需修改路由逻辑，只需在 `launchApp` 中替换 `transport` 适配器。

```ts
import { HonoAdapter } from "tsdkarc-x";

export const app = launchApp({
  basePath: "/api",
  transport: new HonoAdapter(), // 切换为 Hono
  createContext,
  routes: { users: userRoutes },
  port: 3000,
});
```

或者在支持现代 Web Standard `Request` / `Response` API 的框架中（例如 Next.js），使用 `FetchAdapter`：

```ts
import { FetchAdapter, toFetchHandler } from "tsdkarc-x/fetch";

export const transport = new FetchAdapter({
  log: true,
});
const app = await launchApp({
  basePath: "/api/tsdkarc",
  transport,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;

// api/tsdkarc/[...path]/route.ts
const fetchHandler = toFetchHandler(transport);
export const GET = fetchHandler;
export const POST = fetchHandler;
```

### 生成前端类型文件与 OpenAPI

支持将类型导出为 `.d.ts` 或生成 OpenAPI 文档，适用于前后端分仓库的场景。

```ts
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";

// 生成 .d.ts
const { clientDts } = await extractAppRoutesTypesFull(app.routes, {
  entryFile: "./server.ts",
});

// 生成 OpenAPI 配置
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

**Q: `tsdkarc-x` 和 `tsdkarc` 是什么关系？**

`tsdkarc` 负责模块化的依赖注入；`tsdkarc-x` 在此基础上构建 RPC 路由层。`defineRouter` 可直接接收 `tsdkarc` 的模块，两者的类型推导机制完全打通。

**Q: `r.query` 不传 Schema 会怎样？**

输入类型将退化为 handler 第一个参数的手写类型。此时仅有静态类型约束，没有运行时的入参校验。

**Q: `stream` 的 handler 必须是 `async function*` 吗？**

是的，`r.stream` 依赖 Generator 的 `yield` 将数据推送至前端。前端使用 `for await...of` 消费，原生支持增量语义。

**Q: 上传接口里的 `z.coerce.number()` 是为什么？**

Multipart FormData 的字段在网络传输中均为字符串形式，使用 `z.coerce` 可让 Zod 在校验时自动将其转换为目标类型（如 number），省去手动转换的步骤。

**Q: 换成 Hono 需要改业务路由代码吗？**

不需要。仅需替换 `launchApp` 里的 `transport` 和 `createContext`，具体的路由定义和中间件逻辑完全不受影响。

**Q：如何在 ExpressAdapter 中使用 Express 中间件？**

```ts
const transport = new ExpressAdapter();

transport.app.use(cors()); // `app` 是底层的 Express 应用实例
```

**Q：如何在 HonoAdapter 中使用 Hono 中间件？**

```ts
const transport = new HonoAdapter();

transport.app.use(...); // `app` 是底层的 Hono 应用实例
```

**Q: 如何在支持 Web Standard `fetch` 的框架中使用 `tsdkarc-x`？**

许多现代框架都支持标准的 `Request` / `Response` API，例如 Next.js、Bun 和 Deno。

`tsdkarc-x` 通过 `fetch` 适配器支持这些框架，可以在所有这些环境中运行：

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

**Q: 如何在 Next.js 中运行？**

点击查看 [Next.js Example](https://github.com/tsdk-monorepo/tsdkarc/tree/main/examples/nextjs-example/)

或者按照下列步骤：

1. 创建文件 `project/app/api/arcx/[...tsdkarc]/route.ts`:

```ts
import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "project/server/main";

const handler = toFetchHandler(transport);
export const GET = handler;
export const POST = handler;
```

2. `project/server/main.ts` 内容:

```ts
// main.ts
import { defineRouter, launchApp, RoutesOf } from "tsdkarc-x";
import { FetchAdapter } from "tsdkarc-x/fetch";

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define specific routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
export const routes = { users: userRoutes }; // routesExportName

export const transport = new FetchAdapter({
  log: true,
});

const app = await launchApp({
  basePath: "/api/tsdkarc",
  transport,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;
```

3. 访问 `http://localhost:3000/api/neat/users/health` 查看结果

**Q: 为什么 `tsdkarc-x/scripts` 不支持 TS7？**

`tsdkarc-x/scripts` 依赖 TypeScript 提供的 Compiler API，而截至目前，TS7 尚未提供兼容的接口，因此暂时不支持 TS7。

不过，这一限制仅影响 `tsdkarc-x/scripts`，`tsdkarc-x` 的其他功能均可正常使用。

**Q: `tsdkarc-x` 和 `tsdk` 是什么关系？**

`tsdk` 是作者最早的端到端类型安全接口开发工具。虽然采用的是基于脚本生成的方案，但在实践过程中遇到了多模块分发与共享等问题，于是诞生了 `tsdkarc`，随后又发展出了体验更好的 `tsdkarc-x`。

没有 `tsdk`，就不会有今天的 `tsdkarc` 和 `tsdkarc-x`。

未来，作者将把主要精力投入到 `tsdkarc` 系列的开发与维护。不过，作为一切的起点，`tsdk` 仍会发布正式的 `1.0` 版本，为它画上一个完整的句号。🥇

---

## API 参考

### 路由构造

| API                                        | 说明                                                       |
| ------------------------------------------ | ---------------------------------------------------------- |
| `defineRouter({ modules, middlewares })`   | 创建 `appRouter` 实例，接受模块与全局中间件配置            |
| `appRouter.init((r, ctx) => routesObject)` | 定义路由树，`r` 包含 `query/mutate/stream/upload/use` 方法 |
| `r.use(middleware)`                        | 为单条路由添加局部中间件                                   |
| `defineMiddleware<Ctx, Meta>()(...)`       | 定义请求中间件                                             |

### 辅助类型工具 (Helper Types)

| 类型工具                        | 说明                                                               | 示例场景                                                                      |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `ContextOf<typeof module>`      | 提取特定 DI 模块初始化后的上下文类型。                             | `type AppCtx = ContextOf<typeof dbModule>`                                    |
| `MiddlewareExt<typeof mw>`      | 提取某个中间件向 `meta` 中**新增注入（Ext）** 的对象类型。         | `type AuthExt = MiddlewareExt<typeof authMw>`，下游中间件可将其作为泛型入参。 |
| `MiddlewareNextMeta<typeof mw>` | 提取经过该中间件后，传递给下游的**完整** `meta` 类型。             | 用于获取请求流经某个节点后的全量快照类型。                                    |
| `MiddlewareEnv<Ctx, Meta>`      | 提取中间件的 `env` (包含 `ctx`, `meta`, `waitUntil` 等) 参数类型。 | 适用于将大段中间件逻辑抽离成普通独立函数的场景。                              |

### 服务端运行

| API                                                   | 说明                                   |
| ----------------------------------------------------- | -------------------------------------- |
| `launchApp({ ...config })`                            | 启动 HTTP 服务                         |
| `ExpressAdapter()` / `HonoAdapter()` / `FetchAdapter` | HTTP / Request&Response 标准框架适配器 |
| `RpcError(code, message)`                             | 抛出结构化异常                         |

### 类型工具

| API                             | 说明                                   |
| ------------------------------- | -------------------------------------- |
| `RoutesOf<typeof app>`          | 提取供客户端使用的完整路由类型         |
| `InferRouteTree<typeof routes>` | 仅通过路由对象提取类型（无需启动服务） |

### 前端调用

```ts
import { createClient } from "tsdkarc-x/client";

import { createSwrClient } from "tsdkarc-x/react/swr";
import { createQueryClient as createReactQueryClient } from "tsdkarc-x/react/query";
import { createQueryClient as createVueQueryClient } from "tsdkarc-x/vue/query";
```

| API                                         | 说明                                   |
| ------------------------------------------- | -------------------------------------- |
| `createClient<AppRoutes>(config)`           | 创建类型安全的客户端实例               |
| `isRpcError(err)`                           | 验证并收窄 `RpcError` 错误类型         |
| `createSwrClient<AppRoutes>(client)`        | 将基础 client 包装为 SWR Hooks         |
| `createReactQueryClient<AppRoutes>(client)` | 将基础 client 包装为 React Query Hooks |
| `createVueQueryClient<AppRoutes>(client)`   | 将基础 client 包装为 Vue Query Hooks   |

### 代码生成

| API                              | 说明                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `extractAppRoutesTypesFull(...)` | 解析并生成客户端相关的类型声明文件（`.d.ts`），暂不支持 TS 7 |
| `extractOpenApi(...)`            | 从路由结构生成 OpenAPI 规范文档对象 ，暂不支持 TS 7          |

## 问题反馈

若有任何疑问或者 BUG 反馈，请提交至 https://github.com/tsdk-monorepo/tsdkarc/issues
