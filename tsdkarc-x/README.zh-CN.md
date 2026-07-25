# tsdkarc-x

> **基于 tsdkarc 的类型安全 RPC 框架：路由定义、中间件链、多协议适配器与全链路类型推导**

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-blue.svg)](https://www.typescriptlang.org/)
[![Built on tsdkarc](https://img.shields.io/badge/built%20on-tsdkarc-orange.svg)](https://www.npmjs.com/package/tsdkarc)

🇨🇳 中文 · [🇺🇸 English](./README.md)

`tsdkarc-x` 是构建在 `tsdkarc` 之上的 RPC 框架：写一个后端路由，前端 `client` 自动拿到对应的类型和调用方法，中间不需要手写任何接口类型、不需要额外的代码生成步骤盯着看。

下面按从简单到复杂的顺序，逐步介绍它是怎么工作的。

---

## 安装

```bash
npm install tsdkarc-x tsdkarc zod
```

适配器按需安装对应的 HTTP 框架，例如 `express` 或 `hono`。

---

## 第一步：写一个最小的路由并启动服务

一个路由就是一个函数（或字符串常量），挂在 `appRouter.init()` 返回的对象里：

```ts
// server.ts
import { defineRoutes } from "tsdkarc-x";
import { launchApp } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x";

const appRouter = defineRoutes({}); // 先不接模块、不接中间件

const userRoutes = appRouter.init(() => ({
  health: () => "OK", // 最简单的 handler：一个同步函数
}));

export const app = launchApp({
  basePath: "/api",
  transport: new ExpressAdapter(),
  routes: { users: userRoutes },
  port: 3011,
});
```

`launchApp` 启动一个 HTTP 服务，把 `routes` 对象挂载到 `basePath` 下。这一步还没有任何类型魔法，就是一个普通的 Express 服务，`GET /api/users/health` 会返回 `"OK"`。

---

## 第二步：把类型接到前端

`app` 是一个 Promise，resolve 之后可以用 `RoutesOf<typeof app>` 拿到整棵路由树的类型：

```ts
// server.ts（接第一步）
import { type RoutesOf } from "tsdkarc-x";

export type AppRoutes = RoutesOf<typeof app>;
```

前端用 `createClient<AppRoutes>` 创建客户端，调用路径和后端定义的路由结构完全一致（`users.health` 对应后端 `{ users: userRoutes }` 里的 `health`）：

```ts
// client.ts
import { createClient } from "tsdkarc-x";
import type { AppRoutes } from "./server";

const client = createClient<AppRoutes>({
  baseURL: "http://localhost:3011/api",
});

const health = await client.users.health.query(); // "OK"，且有类型提示
```

到这里，`tsdkarc-x` 最核心的价值就出现了：**服务端路由的类型，一路推导到了前端的调用点**。接下来的内容都是在这个基础上，逐个介绍怎么给路由加上更真实的能力。

---

## 第三步：加上入参校验（Zod Schema）

`r.query(schema, handler)` 的第一个参数是可选的 Zod Schema，会在服务端自动校验，并且 `input` 的类型由 Schema 推导出来：

```ts
const userRoutes = appRouter.init((r) => ({
  health: () => "OK",

  getProfile: r.query(
    z.object({
      includeHistory: z.boolean().default(false),
    }),
    async (input) => {
      // input.includeHistory: boolean，已经过校验
      return { id: "u_1", history: input.includeHistory ? [] : null };
    }
  ),
}));
```

前端调用时，`includeHistory` 的类型和默认值也会同步出现在补全里：

```ts
const profile = await client.users.getProfile.query({ includeHistory: true });
```

不传 Schema 也可以（如第一步的 `health`），此时不会有运行时校验，`input` 的类型由 handler 参数上手写的类型决定。

写操作用 `r.mutate(schema, handler)`，用法与 `r.query` 一致，语义上表示会产生副作用：

```ts
updateTheme: r.mutate(
  z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
  (input) => `Theme changed to ${input.theme}`
),
```

---

## 第四步：注入依赖（Context 与 DI）

真实的 handler 通常需要访问数据库、邮件服务这类依赖。`tsdkarc-x` 直接复用 `tsdkarc` 的模块系统：先用 `defineModule` 声明一个模块，再把它塞进 `defineRoutes({ modules: [...] })`，handler 的第二个参数 `env.ctx` 上就会出现对应的依赖，并且类型是自动推导出来的：

```ts
import { defineModule } from "tsdkarc";

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
}));

export const appRouter = defineRoutes({
  modules: [dbModule], // 声明依赖
});

const userRoutes = appRouter.init((r) => ({
  getProfile: r.query(
    z.object({ includeHistory: z.boolean().default(false) }),
    async (input, env) => {
      const user = env.ctx.db.findUser("u_1"); // ✅ 类型自动来自 dbModule
      return { ...user, history: input.includeHistory ? [] : null };
    }
  ),
}));
```

模块本身不知道自己会被哪个路由使用，因此可以独立发布、跨项目复用——这部分完整的组合规则见 `tsdkarc` 文档。

---

## 第五步：加上请求级上下文与中间件

到目前为止 handler 还不知道"谁在发请求"。这一步引入两个概念：

**`createContext`**：每次请求执行一次，从原始 `Request` 提取轻量信息（建议用 getter，避免没用到时也解析 header）：

```ts
export const createContext = async (c: Request) => ({
  get token() {
    return c.header("Authorization") || null;
  },
});
```

**中间件**：用 `defineMiddleware<InputCtx>()(async (ctx, next) => next(patch))` 定义，`next` 传入的字段会合并进后续中间件和 handler 的 `env.meta`：

```ts
export const authMw = defineMiddleware<{ token: string | null }>()(
  async (ctx, next) => {
    // 这里校验 ctx.token，拿到用户信息
    return next({ user: { id: "u_1", role: "admin" } });
  }
);

export const loggerMw = defineMiddleware<{ ip: string | null }>()(
  async (ctx, next) => {
    console.log(`[Access Log] IP: ${ctx.ip}`);
    return next({ traceId: `req_${Date.now()}` });
  }
);
```

把 `createContext` 和全局中间件一起接到 `launchApp` / `defineRoutes`：

```ts
export const appRouter = defineRoutes({
  modules: [dbModule],
  middlewares: [authMw, loggerMw], // 按顺序执行，产出依次合并
});

export const app = launchApp({
  basePath: "/api",
  transport: new ExpressAdapter(),
  createContext, // 每个请求都会先跑这个
  routes: { users: userRoutes },
  port: 3011,
});
```

现在 handler 里的 `env.meta` 就有了 `user` 和 `traceId`：

```ts
ping: r.query(async (_, env) => ({
  message: "pong",
  trace: env.meta.traceId,
  user: env.meta.user.id,
})),
```

**只想给某一个路由加中间件？** 用 `r.use(mw)`，只影响这一条路由，不会污染全局：

```ts
updatePassword: r
  .use(verifyMfaMw) // 只有这个路由会多经过一次 MFA 校验
  .mutate(z.object({ newPwd: z.string().min(8) }), async (input, env) => {
    if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
    return "Password updated securely";
  }),
```

---

## 第六步：错误处理

用 `RpcError(code, message)` 抛出结构化错误，适配器会自动映射成对应的 HTTP 状态码：

```ts
triggerError: r.query(() => {
  throw new RpcError("NOT_FOUND", "This resource has been deleted.");
}),
```

前端用 `isRpcError` 做类型收窄，Zod 校验失败时 `err.issues` 会带上具体的字段信息：

```ts
import { isRpcError } from "tsdkarc-x";

try {
  await client.users.updatePassword.mutate({ newPwd: "123" }); // 少于 8 位
} catch (err) {
  if (isRpcError(err)) {
    console.log(err.code, err.issues); // "BAD_REQUEST", [...]
  }
}
```

---

## 第七步：命名空间嵌套

路由树可以直接嵌普通对象，不需要额外 API，前端调用路径与后端定义一一对应：

```ts
const userRoutes = appRouter.init((r) => ({
  settings: {
    getTheme: r.query(() => "dark_mode"),
    updateTheme: r.mutate(
      z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
      (input) => `Theme changed to ${input.theme}`
    ),
  },
}));
```

```ts
await client.users.settings.updateTheme.mutate({ theme: "light_mode" });
```

多个业务模块也可以在 `launchApp` 的 `routes` 里按路径拼在一起：

```ts
routes: {
  v1: { users: userRoutes }, // 挂载到 /api/v1/users/...
  admin: adminRoutes,
},
```

---

## 第八步：流式响应（SSE）

`r.stream(schema, handler)` 的 `handler` 必须是 `async function*`，`yield` 出去的每一项都会实时推送到前端：

```ts
downloadLogs: r.stream(
  z.object({ lines: z.number().max(10) }),
  async function* (input, env) {
    for (let i = 0; i < input.lines; i++) {
      await new Promise((res) => setTimeout(res, 300));
      yield { index: i, text: `Log trace ${env.meta.traceId} - Line ${i}` };
    }
  }
),
```

前端用 `for await...of` 消费：

```ts
const stream = await client.users.downloadLogs.stream({ lines: 3 });
for await (const chunk of stream) {
  console.log(chunk.index, chunk.text);
}
```

---

## 第九步：文件上传

`r.upload(schema, handler)` 处理 Multipart 请求。FormData 里的字段在网络层始终是字符串，所以数值型字段要用 `z.coerce` 让 Schema 自动转换：

```ts
uploadAvatar: r.upload(
  z.object({
    file: z.instanceof(File),
    cropSize: z.coerce.number().min(100), // 表单传来的字符串会被自动转成 number
  }),
  async (input) => ({
    fileName: input.file.name,
    size: input.file.size,
    croppedTo: input.cropSize,
  })
),
```

前端调用会自动构造 FormData：

```ts
const uploadRes = await client.users.uploadAvatar.upload({
  file: new File(["..."], "avatar.png", { type: "image/png" }),
  cropSize: 250,
});
```

---

## 第十步：后台任务（不阻塞响应）

`env.waitUntil(promise)` 注册一个后台任务：HTTP 响应立即返回，任务在响应之后继续跑完，Node 和 Edge 运行时都安全：

```ts
registerDevice: r.mutate(z.object({ deviceId: z.string() }), async (input, env) => {
  env.waitUntil(
    env.ctx.email.sendBackgroundAlert(`New device logged in: ${input.deviceId}`)
  );
  return { success: true }; // 不等邮件发送完成就返回
}),
```

---

## 第十一步：换一个 HTTP 框架

到目前为止的所有路由代码都不感知具体用的是哪个 HTTP 框架。`launchApp` 的 `transport` 是唯一需要替换的地方：

```ts
import { HonoAdapter } from "tsdkarc-x";

export const app = launchApp({
  basePath: "/api",
  transport: new HonoAdapter(basePath), // 换成 Hono，其余代码不变
  createContext,
  routes: { users: userRoutes },
  port: 3011,
});
```

---

## 第十二步：SWR Hooks

在已有的 `client` 上包一层，得到与路由树同构的 SWR Hooks，Hook 命名路径与 `client` 调用路径一致：

```ts
import { createSwrClient } from "tsdkarc-x";

const swrHooks = createSwrClient<AppRoutes>(client);
// swrHooks.users.getProfile.useQuery(...)
```

---

## 第十三步：生成客户端类型与 OpenAPI 文档

前面所有例子里，前端类型都是通过 `RoutesOf<typeof app>` 在同一个项目里直接推导出来的。如果前后端分仓库，或者想要落地成 `.d.ts` 文件和 OpenAPI 文档，可以用下面两个脚本，它们基于静态 TS 类型分析，不依赖运行时反射：

```ts
import { extractAppRoutesTypesFull } from "tsdkarc-x/scripts";

const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
  res.routes,
  {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
  }
);

await fs.writeFile("./app-routes.d.ts", clientDts);
```

```ts
import { extractOpenApi } from "tsdkarc-x/scripts";
import { apiReference } from "@scalar/express-api-reference";

const openapi = extractOpenApi(
  res.routes,
  {
    info: { title: "My API", version: "1.0.0" },
    servers: [{ url: `http://localhost:${port}/api` }],
  },
  {
    entryFile: path.resolve("./server.ts"),
    routesExportName: "routes",
    tsConfigFilePath: path.resolve("./tsconfig.json"),
  }
);

adapter.app.get(`${basePath}/openapi`, (req, res) => res.json(openapi));
adapter.app.use(
  "/reference",
  apiReference({ url: `http://localhost:${port}${basePath}/openapi` })
);
```

---

## API 参考

**路由构造**

| API                                                              | 说明                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `defineRoutes({ modules, middlewares })`                         | 创建 `appRouter`，`modules` 为 `tsdkarc` 模块列表，`middlewares` 为全局中间件列表 |
| `appRouter.init((r, ctx) => routesObject)`                       | 声明一棵路由树，`r` 提供 `query` / `mutate` / `stream` / `upload` / `use`         |
| `r.use(middleware)`                                              | 返回带路由级中间件的 `r`，链式调用后接 `.query` / `.mutate` 等                    |
| `defineMiddleware<InputCtx>()(async (ctx, next) => next(patch))` | 定义可链式组合的中间件                                                            |

**服务端运行**

| API                                                               | 说明                                    |
| ----------------------------------------------------------------- | --------------------------------------- |
| `launchApp({ basePath, transport, createContext, routes, port })` | 启动 HTTP 服务，返回 `{ routes, stop }` |
| `new ExpressAdapter()` / `new HonoAdapter(basePath)`              | 可替换的 HTTP 框架适配器                |
| `RpcError(code, message)`                                         | 抛出结构化错误，自动映射 HTTP 状态码    |

**类型工具**

| API                             | 说明                                            |
| ------------------------------- | ----------------------------------------------- |
| `RoutesOf<typeof app>`          | 从已启动的 `app` 推导出前端可用的路由类型       |
| `InferRouteTree<typeof routes>` | 直接从路由树对象推导类型（无需等待 `app` 启动） |

**前端**

| API                                  | 说明                                |
| ------------------------------------ | ----------------------------------- |
| `createClient<AppRoutes>(config)`    | 创建强类型 RPC 客户端               |
| `isRpcError(err)`                    | 类型收窄，判断错误是否为 `RpcError` |
| `createSwrClient<AppRoutes>(client)` | 在 `client` 上包装出 SWR Hooks      |

**代码生成**

| API                                            | 说明                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `extractAppRoutesTypesFull(routes, options)`   | 产出 `clientDts` / `swrDts` / `reactQueryDts` 三份类型声明 |
| `extractOpenApi(routes, openApiInfo, options)` | 从路由树生成 OpenAPI 文档对象                              |

---

## ❓ FAQ

**Q: `tsdkarc-x` 和 `tsdkarc` 是什么关系？**

`tsdkarc` 负责模块化依赖注入；`tsdkarc-x` 在其上构建 RPC 路由层，`defineRoutes` 的 `modules` 参数直接接收 `tsdkarc` 的模块，两者的 `ctx` 推导机制完全打通。

**Q: `r.query` 不传 Schema 会怎样？**

输入类型退化为 handler 第一个参数手写的类型，不会有运行时校验，仅做类型层面的约束。

**Q: `stream` 的 handler 必须是 `async function*` 吗？**

是的，`r.stream` 通过 Generator 的 `yield` 将数据实时推送到前端，前端用 `for await...of` 消费，天然支持 SSE 的增量语义。

**Q: 上传接口里的 `z.coerce.number()` 是为什么？**

Multipart FormData 的字段在网络层始终以字符串形式传输，`z.coerce` 让 Schema 在校验阶段自动把字符串转换为目标类型，避免手动 `parseInt`。

**Q: 换成 Hono 需要改业务路由代码吗？**

不需要。`launchApp` 的 `transport` 字段是唯一需要替换的地方，路由定义、中间件、Client 侧代码均不受影响。

---

## 仓库结构

```text
tsdkarc-x/         # RPC 路由层核心库（server / client / adapters）
tsdkarc/           # 底层模块化 DI 库
scripts/
  extract-types/   # 客户端类型 / SWR / React Query 类型生成脚本
  openapi/         # OpenAPI 文档提取脚本
```

---

## 其他

[MIT](./LICENSE)
