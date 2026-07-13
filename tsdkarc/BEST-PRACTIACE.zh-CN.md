# tsdkarc 项目最佳实践

写给 LLM 阅读/生成代码用。目标：任何一个文件都能被独立重写而不破坏其他文件。

---

## 1. 拆分 logic 和 module：复杂业务代码不写在 `defineModule` 闭包里

**问题**：把业务函数直接定义在 `.init((ctx) => {...})` 闭包里，无法脱离 tsdkarc 单测，也无法脱离 ctx 单独阅读。

**规则**：每个模块拆成两个文件。

- `*.logic.ts`：纯函数或类，第一个参数永远是显式 `deps` 对象，不 import tsdkarc，可以脱离整个应用单测。
- `*.module.ts`：只做"从 ctx 取 deps → 调 logic 函数"，不允许出现其他形态的代码。

```ts
// user.logic.ts —— 纯逻辑，deps 显式传入
export class UserService {
  constructor(private logger, private db) {}
  async createUser(input: CreateUserInput) {
    onst[row] = await this.db.insert(usersTable).values(input).returning();
    this.logger.info("user created", { id: row.id });
    return row;
  }
}
```

```ts
// user.module.ts —— 只做接线，几乎不用看
export const userModule = defineModule({
  name: "user",
  modules: [dbModule, loggerModule],
}).init((ctx) => {
  return new UserService(ctx.logger, ctx.db.client);
});
```

单测时完全不需要 tsdkarc：

```ts
await createUser(
  { db: fakeDb, logger: fakeLogger },
  { name: "a", email: "a@b.com" }
);
```

---

## 2. deps / actions 类型用 `ContextOf` 反推，不要手写

**问题**：手写 `interface UserDeps { db: DbClient; logger: Logger }`，模块返回结构一变，这个接口不会自动跟着变。

**规则**：用 `ContextOf<typeof someModule>` 从模块本身反推类型，`import type` 是编译期擦除,不会给 `*.logic.ts` 引入运行时依赖。

```ts
import type { ContextOf } from "tsdkarc";
import type { dbModule } from "../../infra/db.module.js";
import type { loggerModule } from "../../infra/logger.module.js";

/** 派生自模块真实 ctx 形状；模块导出变了，这个类型自动跟着变。 */
export interface UserDeps {
  db: ContextOf<typeof dbModule>["db"]["client"];
  logger: ContextOf<typeof loggerModule>["logger"];
}
```

同理，HTTP handler 需要的 actions 类型直接等于模块暴露出的切片，不要重复声明函数签名：

```ts
export type UserActions = ContextOf<typeof userModule>["user"];
```

**⚠️ 权衡（最小权限优先于偷懒）**：只取用得到的字段路径（如 `["db"]["client"]`），不要 `Pick<ContextOf<typeof dbModule>, "db">` 整段拿。整段拿会把 `close()` 这类模块自己才该用的能力一起带给业务逻辑层。派生类型不等于无脑全量继承。

---

## 3. 消灭手写的重复字面量/类型清单

**问题**：两个文件里各写一份"应该相同"的枚举/常量列表（比如日志级别既在 logger 里定义一遍，又在 config 的 zod schema 里定义一遍），改一处忘改另一处不会报错。

**规则**：只在产生这个概念的文件里定义一次，其他地方 import。

```ts
// logger.logic.ts —— 唯一源
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
```

```ts
// config.logic.ts —— 引用，不重写
import { LOG_LEVELS } from "./logger.logic.js";
const ConfigSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});
```

---

## 4. 基础设施模块不暴露原始句柄，只暴露动作

**问题**：`boot()` 返回 `{ client, sqlite }`，看似只是多返回一个字段，实际让任何拿到 ctx 的模块都能绕过封装直接操作原始连接。

**规则**：只暴露"做什么"（`close()`），不暴露"怎么做"（原始连接对象）。

```ts
// ❌ 暴露原始句柄
return { client: drizzleClient, sqlite: rawConnection };

// ✅ 只暴露动作
return { client: drizzleClient, close: () => rawConnection.close() };
```

---

## 5. 路由用 `Router()` + 前缀隔离，不要挂在共享 `app` 上

**问题**：多个 feature 模块都直接 `ctx.httpServer.app.get(...)`，路径撞了不会有编译期或启动期报错，只有请求测试时才会发现被覆盖。

**规则**：每个 feature 自己起一个 `Router()`，挂载时带上专属前缀。

```ts
export const userRoutes = defineModule({
  name: "userRoutes",
  modules: [httpServerModule, userModule],
}).init((ctx) => {
  const router = Router();
  router.post("/", createUserHandler(ctx.user));
  ctx.httpServer.app.use("/api/users", router);
  return { mountedAt: "/api/users" };
});
```

---

## 6. 错误处理：定义 `HttpError`，统一 JSON 响应，但要等所有路由挂完再 attach

**问题**：不处理业务异常（如唯一键冲突），异常直接冒泡到 Express 默认错误处理器，返回非 JSON 的 500 页面。

**规则**：

1. 逻辑层抛语义化的 `HttpError(status, message)`，不要让驱动层原始错误（如 SQLite 错误）直接冒泡到 HTTP 层。
2. 统一错误处理中间件必须在**所有路由模块 boot 完成之后**才 `app.use(handler)`——Express 的错误中间件按注册顺序生效，太早挂等于没挂。放进组合根的全局 `afterBoot` 钩子里最合适。

```ts
// error-handler.logic.ts
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function attachJsonErrorHandler(app: Express, logger: Logger) {
  app.use(((err, _req, res, _next) => {
    if (err instanceof HttpError)
      return res.status(err.status).json({ error: err.message });
    logger.error("unhandled request error", { message: String(err) });
    res.status(500).json({ error: "internal server error" });
  }) as ErrorRequestHandler);
}
```

```ts
// app.ts —— 组合根，afterBoot 里最后挂
afterBoot: async (ctx) => {
  attachJsonErrorHandler(ctx.httpServer.app, ctx.logger); // 此时所有路由已挂完
  await ctx.httpServer.listen();
},
```

---

## 7. `listen()` 和创建 server 解耦

**问题**：`httpServerModule` 自己的 `afterBoot` 里直接 `listen()`，导致这个模块没法在测试里单独 boot 而不占用端口。

**规则**：`createHttpServer()` 只建 app，不监听；`listen()` 单独暴露成一个方法，由组合根的全局 `afterBoot` 显式调用——这样"何时开始接受请求"是组合根的决策，不是基础设施模块自己的决策。

```ts
export function createHttpServer(port: number): HttpServer {
  const app = express();
  let server: Server | null = null;
  return {
    app,
    listen: () =>
      new Promise((r) => {
        server = app.listen(port, r);
      }),
  };
}
```

---

## 8. 配置只在一处读 env，校验失败即 throw

**规则**：唯一读 `process.env` 的地方是 `configModule`，用 zod 校验，失败直接 `throw`——交给 tsdkarc 的 boot 失败自动回滚机制处理，不需要自己写额外的错误兜底。

```ts
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `[config] invalid environment variables: ${parsed.error.message}`
    );
  return parsed.data;
}
```

---

## 检查清单（新增一个 feature 时逐条对照）

- [ ] `<name>.logic.ts` 里的函数或类第一个参数是显式 `deps`，没有 import tsdkarc
- [ ] `<name>.module.ts` 里只有"取 ctx 字段 → 传给 logic 函数"，没有业务逻辑
- [ ] deps / actions 类型用 `ContextOf<typeof someModule>` 反推，且只取用得到的字段路径
- [ ] 没有和别的文件重复的字面量/枚举列表
- [ ] 基础设施模块只暴露动作（`close()`/`listen()`），不暴露原始句柄
- [ ] 路由用独立 `Router()` + 前缀挂载
- [ ] 业务异常抛 `HttpError`，不让驱动层原始错误冒泡到 HTTP 层
