import { defineModule } from "tsdkarc";
import type { AnyModule, DepCtxFromList, Simplify } from "tsdkarc";
import type { ZodType } from "zod";
import type {
  TransportAdapter,
  Middleware,
  FoldMiddlewares,
  RawRouteDict,
  NormaliseRouteDict,
  AnyRoute,
  RouteBuilder,
  HandlerEnv,
  RouteFactoryTree,
  InferRouteTree,
  CreateContextFn,
  PlainRoute,
  RouteTreeModule,
  RuntimeRouteTree,
} from "./types";
import { isRouteTreeModule } from "./types";

/**
 * ### 💡 API 签名速查表 (API Cheat Sheet)
 *
 * **`defineMiddleware<TInCtx>()(handler)`**
 * - 这是一个**柯里化 (Curried)** 函数，用于彻底解决 TypeScript 的泛型推导死锁问题。
 * - `<TInCtx>`: 显式声明该中间件的**输入契约 (Input Contract)**。中间件只有在满足该上下文结构的环境中才能被挂载。
 * - `handler(ctx, next)`: 异步执行函数。
 * - `ctx`: 当前已累加的强类型上下文（包含 BaseCtx、DI 模块以及上游中间件注入的 Meta）。
 * - `next(ext)`: 将控制权交还给下游，并将 `ext` (新提取的上下文) 安全地合并到全链路上下文中。
 *
 * ---
 *
 * ### ⚙️ 核心设计哲学 (Design Philosophy)
 * - **纯函数无副作用**: 中间件绝对不直接修改原始 `ctx` 对象，而是通过 `next({ ... })` 向下传递增量数据。
 * - **类型滚雪球 (Snowball Inference)**: 每经过一个中间件，下游接收到的类型就会自动变大。
 * - **依赖倒置**: 中间件不需要知道自己运行在 Hono 还是 Express 上，它只面向强类型的 `ctx` 编程。
 *
 * ---
 *
 * ### 📖 典型代码示例 (Examples)
 *
 * #### 1. 声明输入契约与输出类型 (Contracts & Injections)
 * ```typescript
 * // The generic <BaseCtx> strictly requires { token: string } to exist upstream.
 * const authMw = defineMiddleware<BaseCtx>()(async (ctx, next) => {
 * if (!ctx.token) {
 * throw new RpcError("UNAUTHORIZED", "Missing Bearer Token");
 * }
 *
 * // 🚀 Magic! Downstream handlers will perfectly infer `ctx.user.id`
 * return next({ user: { id: "u_1", role: "admin" } });
 * });
 * ```
 *
 * #### 2. 路由级超细粒度控制 (Granular Route Middlewares)
 * ```typescript
 * // This middleware demands that `authMw` has already injected the `user` object!
 * const requireAdminMw = defineMiddleware<{ user: { role: string } }>()(
 * async (ctx, next) => {
 * if (ctx.user.role !== "admin") {
 * throw new RpcError("FORBIDDEN", "Admin privileges required.");
 * }
 * // Flags the request as verified for downstream handlers
 * return next({ isAdmin: true });
 * }
 * );
 * ```
 */

/**
 * ### 💡 API 签名速查表 (API Cheat Sheet)
 *
 * **`defineRoutes({ modules?, middlewares? })`**
 * - `modules` *(可选)*: 当前路由组依赖的底层 DI 模块数组。
 * - `middlewares` *(可选)*: 作用于该路由蓝图的中间件数组（按洋葱模型顺次执行）。
 * - **返回值**: 一个强类型的“路由蓝图 (Router Blueprint)”，此时路由尚未实例化。
 *
 * **`.extend({ modules?, middlewares? })`**
 * - **蓝图派生**: 继承当前蓝图的所有模块与中间件，并动态追加新的模块与中间件。
 * - **返回值**: 一个全新的路由蓝图。极其适合用于分离公共路由 (Public) 与鉴权路由 (Protected)。
 *
 * **`.init(factory)`**
 * - **蓝图消费**: 实例化当前蓝图，生成最终可被 Transport 挂载的路由节点。
 * - `factory(r, ctx)`: 核心工厂函数。接收路由构建器 `r` 与已解析的依赖上下文 `ctx`，返回包含具体 handler 的对象。
 *
 * ---
 *
 * ### ⚙️ 核心路由构建器 (Route Builder `r`)
 * 在 `.init()` 中，参数 `r` 提供了构建各类端点的核心方法：
 * - **`r.query(schema?, handler)`**: 定义查询端点 (等同于 GET)。
 * - **`r.mutation(schema?, handler)`**: 定义状态变更端点 (等同于 POST/PUT)。
 * - **`r.stream(schema?, handler)`**: 定义 SSE 流式端点。传入的 handler 必须为异步生成器 (`async function*`)。
 * - **`r.upload(schema?, handler)`**: 定义文件上传端点 (解析 multipart/form-data)。
 * - **`r.use(middleware)`**: 路由级中间件挂载。返回一个全新的 `r` 实例，实现超细粒度的权限控制。
 *
 * > **Handler 签名规范**: 所有 handler 统一接收 `(input, env)` 两个参数。
 * > - `input`: 经过 `schema` 严格类型校验后的合法入参。
 * > - `env`: 边缘环境与上下文合集。包含 `ctx` (DI 依赖)、`meta` (中间件注入的产物) 以及 `waitUntil` (Serverless 幽灵任务逃生舱)。
 *
 * ---
 *
 * ### 📖 典型代码示例 (Examples)
 *
 * #### 1. 构建基础蓝图 (Base Router Blueprint)
 * 拒绝重复配置！将全局依赖和公共中间件注入基座蓝图。
 * ```typescript
 * // The AppContext is extracted automatically from your Transport boundary
 * type BaseCtx = Awaited<ReturnType<typeof createContext>>;
 *
 * export const appRouter = defineRoutes({
 * modules: [dbModule, emailModule], // Global dependencies
 * middlewares: [
 * defineMiddleware<BaseCtx>()(async (ctx, next) => {
 * // Injects traceId for all downstream requests
 * return next({ traceId: `req_${Date.now()}` });
 * })
 * ]
 * });
 * ```
 *
 * #### 2. 蓝图派生与隔离 (Blueprint Extension & Isolation)
 * 使用 `.extend()` 零成本派生子蓝图，轻松实现鉴权栈等垂直切面。
 * ```typescript
 * // Inherits the DB/Email modules and the logger middleware from appRouter!
 * export const protectedRouter = appRouter.extend({
 * middlewares: [
 * defineMiddleware<BaseCtx>()(async (ctx, next) => {
 * if (!ctx.token) throw new RpcError("UNAUTHORIZED", "Missing Token");
 * // ctx.db is perfectly inferred from the parent blueprint
 * const user = ctx.db.findUser(ctx.token);
 * return next({ user });
 * })
 * ]
 * });
 * ```
 *
 * #### 3. 强类型业务消费 (Feature-Rich Route Handlers)
 * 随时随地调用 `.init()` 消费蓝图，完美聚合所有上下文类型。
 * ```typescript
 * import { z } from "zod";
 *
 * export const userRoutes = protectedRouter.init((r, ctx) => ({
 * updateProfile: r.mutation(
 * z.object({ name: z.string() }),
 * async (input, env) => {
 * // 🚀 O(1) Inference: env.ctx.db and env.meta.user are 100% type-safe!
 * await env.ctx.db.updateUser(env.meta.user.id, input.name);
 *
 * // Edge-compatible Background Task (will not block the HTTP response)
 * env.waitUntil(env.ctx.email.sendAlert(`Profile updated: ${input.name}`));
 *
 * return { success: true };
 * }
 * ),
 *
 * // Granular middleware strictly applied to a single endpoint
 * deleteAccount: r
 * .use(verifyMfaMw)
 * .mutation(z.void(), async (_, env) => {
 * if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
 * return "Deleted";
 * })
 * }));
 * ```
 */

/**
 * ### 💡 API 签名速查表 (API Cheat Sheet)
 *
 * **`launchApp({ basePath, transport, createContext, routes, port? })`**
 * - `basePath`: 基础路径。
 * - `transport`: 底层 HTTP 适配器实例（如 `new HonoAdapter()` 或 `new ExpressAdapter()`）。
 * - `createContext(req)`: 边界净水器。负责将脏乱的原始 HTTP Request 转换为纯净的 `BaseCtx`，供整个应用消费。
 * - `routes`: 组装好的路由工厂树 (`RouteFactoryTree`)，支持无限极层级嵌套。
 * - `port` *(可选)*: 服务器监听端口，默认为 3000。
 *
 * **返回值**: `Promise<{ stop, routes }>`
 * - `stop()`: 触发优雅停机，依序关闭底层 Server 和所有 DI 模块。
 * - `routes`: 用于提取 `RoutesOf` 供前端使用的 O(1) 类型。
 *
 * ---
 *
 * ### ⚙️ 核心工作流 (Orchestration Flow)
 * 1. **依赖收集**: 递归扫描 `routes` 树，提取所有挂载的 DI 模块 (`AnyModule`)。
 * 2. **微内核启动**: 隐式创建一个 Root Module，统一进行拓扑排序并安全启动所有的数据库、Redis 等依赖。
 * 3. **适配器挂载**: 将 `createContext` 与扁平化后的最终路由树 (`RuntimeRouteTree`) 绑定到底层 Transport 实例上。
 * 4. **端口监听**: 启动 HTTP 服务，对外提供 API。
 *
 * ---
 *
 * ### 📖 典型代码示例 (Examples)
 *
 * #### 1. 协议隔离与启动引擎 (Transport Isolation & Boot)
 * ```typescript
 * import { ExpressAdapter } from "./express-adapter";
 * import { launchApp, type RoutesOf } from "./core";
 *
 * const app = await launchApp({
 * basePath: "/api",
 * // 1. Bridge the gap between Node.js / Edge and our pure RPC engine
 * transport: new ExpressAdapter(),
 *
 * // 2. Extract the exact BaseCtx signature (e.g., token, ip)
 * createContext: async (req) => ({
 * get token() { return req.header("Authorization") || null; }
 * }),
 *
 * // 3. Mount the assembled feature branches
 * routes: {
 * v1: {
 * users: userRoutes,
 * ai: aiRoutes,
 * }
 * },
 * port: 8080
 * });
 *
 * // 🚀 The Holy Grail: Exporting O(1) types for the frontend client!
 * export type AppRoutes = RoutesOf<typeof app>;
 *
 * // Graceful shutdown listener
 * app.then(({ stop }) => {
 * process.on("SIGINT", async () => {
 * await stop();
 * process.exit(0);
 * });
 * });
 * ```
 *
 * #### 2. 前端极致调用 (Client-Side API Consumption)
 * 前端直接导入类型，享受 100% 自动补全、入参校验与返回值推导，告别 API 文档。
 * ```typescript
 * import { createClient } from "my-rpc/client";
 * import { createSwrClient } from "my-rpc/react/swr";
 * import { createQueryClient } from "my-rpc/react/query";
 * import type { AppRoutes } from "../server";
 *
 * // Initialize the client with the exact same type as the server
 * const api = createClient<AppRoutes>({ url: "http://localhost:8080/api" });
 *
 * // 🚀 Magic happens here: Full IDE autocomplete for nested routes!
 * const profile = await api.v1.users.getProfile.query({ id: "123" });
 *
 * // The returned `profile` is perfectly typed based on the server's return statement.
 * console.log(profile.name);
 *
 * // MFA Protected Mutation
 * await api.v1.users.deleteAccount.mutation();
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Builders & Normalizers
// ─────────────────────────────────────────────────────────────────────────────

function makeRouteBuilder<AppCtx extends object, Meta extends object>(
  routeMiddlewares: Middleware<any, any>[] = []
): RouteBuilder<AppCtx, Meta> {
  return {
    use(mw) {
      return makeRouteBuilder([...routeMiddlewares, mw]);
    },
    query(...args: any[]): any {
      const hasSchema = args[1] !== undefined;
      return {
        _kind: "query",
        schema: hasSchema ? args[0] : undefined,
        handler: hasSchema ? args[1] : args[0],
        ___routeMiddlewares: routeMiddlewares,
      };
    },
    mutation(...args: any[]): any {
      const hasSchema = args[1] !== undefined;
      return {
        _kind: "mutation",
        schema: hasSchema ? args[0] : undefined,
        handler: hasSchema ? args[1] : args[0],
        ___routeMiddlewares: routeMiddlewares,
      };
    },
    stream(...args: any[]): any {
      const hasSchema = args[1] !== undefined;
      return {
        _kind: "stream",
        schema: hasSchema ? args[0] : undefined,
        handler: hasSchema ? args[1] : args[0],
        ___routeMiddlewares: routeMiddlewares,
      };
    },
    upload(...args: any[]): any {
      const hasSchema =
        args[1] !== undefined &&
        typeof args[0] === "object" &&
        "parse" in args[0];
      return {
        _kind: "upload",
        schema: hasSchema ? args[0] : undefined,
        handler: hasSchema ? args[1] : args[0],
        ___routeMiddlewares: routeMiddlewares,
      };
    },
  };
}

function normaliseRouteDict(
  raw: RawRouteDict
): NormaliseRouteDict<RawRouteDict> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "function") {
      result[key] = { _kind: "plain", handler: value } satisfies PlainRoute<
        any,
        any
      >;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !("_kind" in value)
    ) {
      result[key] = normaliseRouteDict(value as RawRouteDict);
    } else {
      result[key] = value;
    }
  }
  return result as NormaliseRouteDict<RawRouteDict>;
}

/**
 * Chains middlewares in order, passing accumulated ctx through each layer.
 *
 * Invariant: middlewares only ADD new keys to ctx — they do not overwrite
 * existing ones. In development, key collisions emit a console.warn so they
 * are caught early instead of silently swallowing data.
 */
async function runMiddlewareChain(
  middlewares: Middleware<any, any>[],
  initialCtx: object,
  handler: (meta: object) => Promise<unknown>
): Promise<unknown> {
  async function dispatch(index: number, ctx: object): Promise<unknown> {
    if (index === middlewares.length) return handler(ctx);
    const mw = middlewares[index]!;
    const { result } = await mw(ctx, async (ext) => {
      if (process.env.NODE_ENV !== "production") {
        for (const key of Object.keys(ext)) {
          if (key in ctx) {
            console.warn(
              `[runMiddlewareChain] middleware[${index}] overwrites existing ctx key: "${key}". ` +
                `Each middleware should only contribute new keys.`
            );
          }
        }
      }
      const nextCtx = { ...ctx, ...ext };
      const res = await dispatch(index + 1, nextCtx);
      return { result: res, ctx: nextCtx as any };
    });
    return result;
  }
  return dispatch(0, initialCtx);
}

async function invokeRoute(
  route: AnyRoute,
  rawInput: unknown,
  env: HandlerEnv<any, any>
): Promise<unknown> {
  if (route._kind === "plain") return route.handler(rawInput, env);
  const schema = (route as any).schema as ZodType | undefined;
  const input = schema ? schema.parse(rawInput) : rawInput;
  return route.handler(input as any, env);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function defineMiddleware<TInCtx extends object = {}>() {
  return <TReturn extends { ctx: any }>(
    fn: (
      ctx: TInCtx,
      next: <T extends object>(
        ext: T
      ) => Promise<{ result: unknown; ctx: Simplify<TInCtx & T> }>
    ) => Promise<TReturn>
  ): Middleware<
    TInCtx,
    Simplify<Omit<Awaited<TReturn>["ctx"], keyof TInCtx>>
  > => fn as any;
}

// Internal counter for generating unique DI module names.
// Each defineRoutes().init() call gets its own stable name so
// buildRuntimeTree can safely index into appCtx.
let _routeModuleCounter = 0;

/**
 * Creates an isolated routing module. Acts as a DI Module.
 *
 * FIXED (vs original):
 *  1. factory now receives (ctx, r) as two separate arguments — previously
 *     ctx and routeBuilder were spread-merged into one object, making the
 *     declared type (RouteBuilder only) a lie.
 *  2. The underlying DI module always has an auto-generated unique name, so
 *     buildRuntimeTree never silently reads `appCtx[undefined]`.
 *  3. Returns a typed RouteTreeModule wrapper instead of using `as any` to
 *     staple ___isRouteTreeModule onto the module object.
 */
export function defineRoutes<
  const TModules extends AnyModule[] = [],
  const TMiddlewares extends Middleware<any, any>[] = []
>(options: { modules?: TModules; middlewares?: TMiddlewares }) {
  type AppCtx = DepCtxFromList<TModules>;
  type Meta = FoldMiddlewares<TMiddlewares>;

  const currentModules = options?.modules || ([] as unknown as TModules);
  const currentMiddlewares =
    options?.middlewares || ([] as unknown as TMiddlewares);

  return {
    extend: <
      const TExtraModules extends AnyModule[] = [],
      const TExtraMiddlewares extends Middleware<any, any>[] = []
    >(extra?: {
      modules?: TExtraModules;
      middlewares?: TExtraMiddlewares;
    }) => {
      return defineRoutes<
        [...TModules, ...TExtraModules],
        [...TMiddlewares, ...TExtraMiddlewares]
      >({
        modules: [...currentModules, ...(extra?.modules || [])] as any,
        middlewares: [
          ...currentMiddlewares,
          ...(extra?.middlewares || []),
        ] as any,
      });
    },
    init<TRaw extends RawRouteDict>(
      /** Receives the resolved dependency context and the route builder separately. */
      factory: (route: RouteBuilder<AppCtx, Meta>, ctx: AppCtx) => TRaw
    ): RouteTreeModule<NormaliseRouteDict<TRaw>> {
      // Always generate a unique name — defineModule's name is optional, but
      // we need a stable key to look up routes in appCtx after boot.
      const moduleName = `__route_module_${_routeModuleCounter++}`;

      const routeMod = defineModule({
        name: moduleName,
        modules: options.modules ?? [],
      }).init((ctx) => {
        const routeBuilder = makeRouteBuilder<AppCtx, Meta>();

        // ctx and routeBuilder are now passed separately — type matches runtime.
        const rawRoutes = factory(routeBuilder, ctx as AppCtx);
        const normalised = normaliseRouteDict(rawRoutes);
        const moduleMiddlewares = options.middlewares ?? [];

        function wrapTree(tree: any): any {
          const wrapped: any = {};
          for (const [key, value] of Object.entries(tree)) {
            if (
              typeof value === "object" &&
              value !== null &&
              !("_kind" in value)
            ) {
              wrapped[key] = wrapTree(value);
            } else {
              const route = value as AnyRoute;
              const combinedMiddlewares = route.___routeMiddlewares?.length
                ? [...moduleMiddlewares, ...(route.___routeMiddlewares || [])]
                : moduleMiddlewares;

              wrapped[key] = {
                ...route,
                handler: (rawInput: unknown, baseEnv: any) =>
                  runMiddlewareChain(
                    combinedMiddlewares,
                    baseEnv.meta ?? {},
                    (meta) =>
                      invokeRoute(route, rawInput, {
                        meta,
                        ctx: ctx as AppCtx,
                        waitUntil: baseEnv.waitUntil,
                      })
                  ),
              };
            }
          }
          return wrapped;
        }

        return { routes: wrapTree(normalised) };
      });

      // Return a typed wrapper — no `as any` punching through the type system.
      return {
        ___isRouteTreeModule: true,
        ___moduleName: moduleName,
        ___type_routes: undefined as any as NormaliseRouteDict<TRaw>,
        _mod: routeMod as unknown as AnyModule,
      } satisfies RouteTreeModule<NormaliseRouteDict<TRaw>>;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively collects all DI modules from a RouteFactoryTree.
 * Reads ._mod instead of treating the RouteTreeModule itself as a module.
 */
function extractRouteModules(tree: RouteFactoryTree): AnyModule[] {
  const mods: AnyModule[] = [];
  for (const val of Object.values(tree)) {
    if (isRouteTreeModule(val)) {
      mods.push(val._mod);
    } else {
      mods.push(...extractRouteModules(val as RouteFactoryTree));
    }
  }
  return mods;
}

/**
 * Recursively maps a RouteFactoryTree to a RuntimeRouteTree by looking up
 * each module's routes in the booted appCtx.
 *
 * Throws explicitly if a module's routes are missing — previously this would
 * silently produce `undefined` when name was optional.
 */
function buildRuntimeTree(
  tree: RouteFactoryTree,
  appCtx: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(tree)) {
    if (isRouteTreeModule(val)) {
      const modCtx = appCtx[val.___moduleName];
      if (!modCtx?.routes) {
        throw new Error(
          `[buildRuntimeTree] routes not found for module "${val.___moduleName}". ` +
            `This is an internal bug — please report it.`
        );
      }
      result[key] = modCtx.routes;
    } else {
      result[key] = buildRuntimeTree(val as RouteFactoryTree, appCtx);
    }
  }
  return result;
}

export async function launchApp<
  TRawReq = unknown,
  TReqCtx extends object = {},
  const TRoutes extends RouteFactoryTree = any
>(options: {
  transport: TransportAdapter<TRawReq>;
  createContext?: CreateContextFn<TRawReq, TReqCtx>;
  routes: TRoutes;
  basePath: string;
  port?: number;
}) {
  const { transport, createContext, routes, port = 3000, basePath } = options;
  const routeModules = extractRouteModules(routes);
  let runtimeTree!: RuntimeRouteTree;
  const rootModule = defineModule({
    modules: routeModules,
  }).init(undefined, {
    afterBoot: async (appCtx) => {
      runtimeTree = buildRuntimeTree(routes, appCtx as Record<string, any>);
      transport.mount(
        basePath,
        runtimeTree,
        createContext ?? (async () => ({} as TReqCtx))
      );
      await transport.start(port, basePath);
    },
    shutdown: async () => {
      await transport.stop();
    },
  });

  const { stop } = await rootModule.start();

  return { stop, routes: runtimeTree as any as InferRouteTree<TRoutes> };
}
