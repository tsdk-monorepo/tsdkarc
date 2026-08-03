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
  MiddlewareEnv,
  NextFn,
  ValidateMiddlewareChain,
} from "./types";
import { isRouteTreeModule } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Builders & Normalizers
// ─────────────────────────────────────────────────────────────────────────────

function makeRouteBuilder<AppCtx extends object, Meta extends object>(
  routeMiddlewares: Middleware<any, any, any>[] = []
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
    mutate(...args: any[]): any {
      const hasSchema = args[1] !== undefined;
      return {
        _kind: "mutate",
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
/**
 * Runs a middleware chain in order, threading `meta` through each layer.
 * Every middleware receives the same fixed `ctx` (DI deps) and `waitUntil`;
 * only `meta` grows as each middleware calls next(ext).
 *
 * Invariant: middlewares only ADD new keys to meta — they do not overwrite
 * existing ones. In development, key collisions emit a console.warn so they
 * are caught early instead of silently swallowing data.
 */
async function runMiddlewareChain(
  middlewares: Middleware<any, any, any>[],
  appCtx: object,
  waitUntil: (promise: Promise<unknown>) => void,
  initialMeta: object,
  handler: (meta: object) => Promise<unknown>
): Promise<unknown> {
  async function dispatch(index: number, meta: object): Promise<unknown> {
    if (index === middlewares.length) return handler(meta);
    const mw = middlewares[index]!;
    const env = { ctx: appCtx, meta, waitUntil };
    const { result } = await mw(env, async (ext) => {
      if (process.env.NODE_ENV !== "production") {
        for (const key of Object.keys(ext)) {
          if (key in meta) {
            console.warn(
              `[runMiddlewareChain] middleware[${index}] overwrites existing meta key: "${key}". ` +
                `Each middleware should only contribute new keys.`
            );
          }
        }
      }
      const nextMeta = { ...meta, ...ext };
      const res = await dispatch(index + 1, nextMeta);
      return { result: res, meta: nextMeta as any };
    });
    return result;
  }
  return dispatch(0, initialMeta);
}

async function invokeRoute(
  route: AnyRoute,
  rawInput: unknown,
  env: HandlerEnv<any, any>
): Promise<unknown> {
  if (route._kind === "plain") return route.handler(rawInput, env);

  const schema =
    "schema" in route ? (route.schema as ZodType | undefined) : undefined;

  // 1. Normalize the input.
  // If the HTTP transport dropped the empty object and yielded undefined, default to {}.
  let safeInput = rawInput === undefined ? {} : rawInput;

  // (Optional) If your GET requests send JSON in a query string like `?input=%7B%7D`,
  // you might also need to parse it if your transport layer hasn't already:
  if (typeof safeInput === "string" && route._kind === "query") {
    try {
      safeInput = safeInput ? JSON.parse(safeInput) : {};
    } catch {
      // If it fails to parse, just pass the string to Zod and let it fail validation
    }
  }

  // 2. Parse using the normalized input
  const input = schema ? await schema.parseAsync(safeInput) : safeInput;

  return route.handler(input as any, env);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function defineMiddleware<
  AppCtx extends object = {},
  TInMeta extends object = {}
>() {
  return <TReturn extends { meta: any }>(
    fn: (
      env: MiddlewareEnv<AppCtx, TInMeta>,
      next: NextFn<TInMeta>
    ) => Promise<TReturn>
  ): Middleware<
    AppCtx,
    TInMeta,
    Simplify<Omit<Awaited<TReturn>["meta"], keyof TInMeta>>
  > => fn as any;
}

// Internal counter for generating unique DI module names.
// Each defineRouter().init() call gets its own stable name so
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
export function defineRouter<
  const TModules extends AnyModule[] = [],
  const TMiddlewares extends Middleware<any, any, any>[] = []
>(options?: {
  modules?: TModules;
  middlewares?: TMiddlewares & ValidateMiddlewareChain<TMiddlewares>;
}) {
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
      return defineRouter<
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
        modules: options?.modules ?? [],
      }).init((ctx) => {
        const routeBuilder = makeRouteBuilder<AppCtx, Meta>();

        // ctx and routeBuilder are now passed separately — type matches runtime.
        const rawRoutes = factory(routeBuilder, ctx as AppCtx);
        const normalised = normaliseRouteDict(rawRoutes);
        const moduleMiddlewares = options?.middlewares ?? [];

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
                    ctx as AppCtx,
                    baseEnv.waitUntil,
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
export function extractRouteModules(tree: RouteFactoryTree): AnyModule[] {
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
  port?: number | string;
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
