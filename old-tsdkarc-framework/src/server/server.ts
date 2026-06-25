import start, {
  AnyModule,
  ContextOf,
  defineUnit,
  ComposableModule,
  MergeSlices,
  StartOptions,
  FullContext,
} from "tsdkarc";
import { type ZodType, type infer as ZInfer, treeifyError } from "zod";
import { ReqMeta, Transport } from "../transport/interface";

// ─── ZodResult ────────────────────────────────────────────────────────────────

export type ZodResult<
  Input,
  Result,
  Kind extends "query" | "mutation" = "query"
> = Promise<Result> & { __input: Input; __kind: Kind };

// ─── Path Utility ─────────────────────────────────────────────────────────────

/**
 * Safely joins path segments and removes duplicate or trailing slashes.
 * e.g., normalizePath("/api/", "/user/hello//") -> "/api/user/hello"
 */
function normalizePath(...parts: string[]): string {
  return "/" + parts.join("/").split("/").filter(Boolean).join("/");
}

// ─── StreamResult ─────────────────────────────────────────────────────────────

export type StreamResult<Input, Yield> = AsyncGenerator<Yield> & {
  __input: Input;
  __kind: "stream";
  __yield: Yield;
};

// ─── Middleware ───────────────────────────────────────────────────────────────

// 1. Allow next() to optionally override the data payload for downstream handlers
export type Next = (overrideData?: unknown) => Promise<unknown>;

export type Middleware<Raw = unknown> = (
  ctx: ArcCtx & { meta: ReqMeta<Raw> },
  data: unknown,
  next: Next
) => Promise<unknown>;

function composeMiddleware(
  middleware: Middleware[],
  handler: (data: unknown, meta: ReqMeta) => unknown, // Support Promise or AsyncGenerator returns
  ctx: ArcCtx & { meta: ReqMeta },
  data: unknown,
  meta: ReqMeta
): Promise<unknown> {
  let index = -1;

  const dispatch = (i: number, currentData: unknown): Promise<unknown> => {
    // 2. Prevent the classic double-next() memory leak bug
    if (i <= index) {
      return Promise.reject(
        new Error("next() called multiple times in middleware")
      );
    }
    index = i;

    const mw = middleware[i];

    // Reached the end of the chain, call the actual route handler
    if (!mw) {
      return Promise.resolve(handler(currentData, meta));
    }

    try {
      // 3. Promise.resolve catches synchronous crashes inside middleware
      return Promise.resolve(
        mw(ctx, currentData, (overrideData?: unknown) => {
          // Pass down the overridden data if provided, otherwise keep the original
          return dispatch(
            i + 1,
            overrideData !== undefined ? overrideData : currentData
          );
        })
      );
    } catch (err) {
      return Promise.reject(err);
    }
  };

  return dispatch(0, data);
}

// ─── Route shapes ─────────────────────────────────────────────────────────────

type PlainHandler = (ctx: any, data: unknown, meta?: ReqMeta) => any;
export type RouteEntry = PlainHandler | Record<string, PlainHandler>;
export type AnyRoute = PlainHandler;

export type RoutesMap<Ctx, Raw = unknown> = {
  [K: string]:
    | ((ctx: Ctx, data?: unknown, meta?: ReqMeta<Raw>) => any)
    | { [SK: string]: (ctx: Ctx, data?: unknown, meta?: ReqMeta<Raw>) => any };
};

// ─── ArcCtx ───────────────────────────────────────────────────────────────────

export interface RouteHelper<Kind extends "query" | "mutation", Raw = unknown> {
  <S extends ZodType, R>(
    schema: S,
    fn: (data: ZInfer<S>, meta: ReqMeta<Raw>) => R
  ): ZodResult<ZInfer<S>, Awaited<R>, Kind>;

  <T = unknown, R = unknown>(fn: (data: T, meta: ReqMeta) => R): ZodResult<
    T,
    Awaited<R>,
    Kind
  >;
}

export interface StreamHelper {
  <S extends ZodType, Y>(
    schema: S,
    fn: (data: ZInfer<S>, meta: ReqMeta) => AsyncGenerator<Y>
  ): StreamResult<ZInfer<S>, Y>;

  <Y>(fn: (data: undefined, meta: ReqMeta) => AsyncGenerator<Y>): StreamResult<
    undefined,
    Y
  >;
}

export interface ArcCtx {
  transport: Transport;
  query: RouteHelper<"query">;
  mutation: RouteHelper<"mutation">;
  stream: StreamHelper;
  /** Register route */
  r<R extends Record<string, RouteEntry>>(
    routes: R,
    wrapped: WrappedRoutes,
    routeMiddleware?: Record<string, Middleware[]>,
    routeMethods?: Record<string, "GET" | "POST" | "STREAM">,
    wrappedStream?: WrappedStreamRoutes // ← add
  ): { ___routes: ClientRoutes<R> };
}
// ─── Client type derivation ───────────────────────────────────────────────────

type IsUnknown<T> = unknown extends T
  ? T extends unknown
    ? true
    : false
  : false;

type HasRequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T] extends never
  ? false
  : true;

type HandlerInput<H extends PlainHandler> = ReturnType<H> extends StreamResult<
  infer Input,
  any
>
  ? IsUnknown<Input> extends true
    ? undefined
    : Input
  : ReturnType<H> extends ZodResult<infer Input, any, any>
  ? IsUnknown<Input> extends true
    ? undefined
    : Input
  : Parameters<H>[1] extends undefined
  ? undefined
  : Parameters<H>[1];

type HandlerResult<H extends PlainHandler> = Awaited<ReturnType<H>>;

type HandlerYield<H extends PlainHandler> = ReturnType<H> extends StreamResult<
  any,
  infer Y
>
  ? Y
  : unknown;

type HandlerKind<H extends PlainHandler> = ReturnType<H> extends StreamResult<
  any,
  any
>
  ? "stream"
  : ReturnType<H> extends ZodResult<any, any, infer K>
  ? K
  : "query";

/**
 * Client function with kind brand preserved for RoutesOfKind filtering.
 * - query/mutation → returns Promise<R> & { __kind, __input }
 * - stream         → returns AsyncGenerator<Y> & { __kind, __input, __yield }
 */
type BrandedClientFn<
  H extends PlainHandler,
  Kind extends "query" | "mutation" | "stream"
> = Kind extends "stream"
  ? HandlerInput<H> extends undefined | void
    ? () => AsyncGenerator<HandlerYield<H>> & {
        __kind: "stream";
        __input: undefined;
        __yield: HandlerYield<H>;
      }
    : HasRequiredKeys<HandlerInput<H>> extends true
    ? (data: HandlerInput<H>) => AsyncGenerator<HandlerYield<H>> & {
        __kind: "stream";
        __input: HandlerInput<H>;
        __yield: HandlerYield<H>;
      }
    : (data?: HandlerInput<H>) => AsyncGenerator<HandlerYield<H>> & {
        __kind: "stream";
        __input: HandlerInput<H>;
        __yield: HandlerYield<H>;
      }
  : HandlerInput<H> extends undefined | void
  ? () => Promise<HandlerResult<H>> & {
      __kind: Kind;
      __input: undefined;
    }
  : HasRequiredKeys<HandlerInput<H>> extends true
  ? (data: HandlerInput<H>) => Promise<HandlerResult<H>> & {
      __kind: Kind;
      __input: HandlerInput<H>;
    }
  : (data?: HandlerInput<H>) => Promise<HandlerResult<H>> & {
      __kind: Kind;
      __input: HandlerInput<H>;
    };

type ClientRoutes<R extends Record<string, RouteEntry>> = {
  [K in keyof R]: R[K] extends PlainHandler
    ? BrandedClientFn<R[K], HandlerKind<R[K]>>
    : R[K] extends Record<string, PlainHandler>
    ? { [NK in keyof R[K]]: BrandedClientFn<R[K][NK], HandlerKind<R[K][NK]>> }
    : never;
};

// ─── Internal flat route map ──────────────────────────────────────────────────

type WrappedRoutes = Record<
  string,
  (data: unknown, meta: ReqMeta) => Promise<unknown>
>;
type WrappedStreamRoutes = Record<
  string,
  (data: unknown, meta: ReqMeta) => AsyncGenerator<unknown>
>;

function flattenRouteMap(
  routes: Record<string, RouteEntry>,
  wrapHandler: (
    path: string,
    handler: PlainHandler
  ) => (data: unknown, meta: ReqMeta) => Promise<unknown>,
  wrapStreamHandler: (
    path: string,
    handler: PlainHandler
  ) => (data: unknown, meta: ReqMeta) => AsyncGenerator<unknown>
): { flat: WrappedRoutes; flatStream: WrappedStreamRoutes } {
  const flat: WrappedRoutes = {};
  const flatStream: WrappedStreamRoutes = {};

  for (const [key, entry] of Object.entries(routes)) {
    if (typeof entry === "function") {
      flat[key] = wrapHandler(key, entry);
      flatStream[key] = wrapStreamHandler(key, entry);
    } else {
      for (const [subKey, handler] of Object.entries(entry)) {
        const path = `${key}/${subKey}`;
        flat[path] = wrapHandler(path, handler);
        flatStream[path] = wrapStreamHandler(path, handler);
      }
    }
  }
  return { flat, flatStream };
}

function buildClientProxy(
  routes: Record<string, RouteEntry>,
  flat: WrappedRoutes
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(routes)) {
    if (typeof entry === "function") {
      result[key] = flat[key];
    } else {
      const ns: Record<string, unknown> = {};
      for (const subKey of Object.keys(entry)) {
        ns[subKey] = flat[`${key}/${subKey}`];
      }
      result[key] = ns;
    }
  }
  return result;
}

// ─── runZod ───────────────────────────────────────────────────────────────────

function runZod<S extends ZodType, R>(
  schema: S,
  data: unknown,
  meta: ReqMeta,
  fn: (data: ZInfer<S>, meta: ReqMeta) => R
): ZodResult<ZInfer<S>, Awaited<R>> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const err = Object.assign(new Error("Validation failed"), {
      status: 400,
      details: treeifyError(parsed.error),
    });
    return Promise.reject(err) as unknown as ZodResult<ZInfer<S>, Awaited<R>>;
  }
  return Promise.resolve(fn(parsed.data, meta)) as unknown as ZodResult<
    ZInfer<S>,
    Awaited<R>
  >;
}

function runZodStream<S extends ZodType, Y>(
  schema: S,
  data: unknown,
  meta: ReqMeta,
  fn: (data: ZInfer<S>, meta: ReqMeta) => AsyncGenerator<Y>
): AsyncGenerator<Y> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const err = Object.assign(new Error("Validation failed"), {
      status: 400,
      details: treeifyError(parsed.error),
    });
    return (async function* () {
      throw err;
    })() as AsyncGenerator<Y>;
  }
  return fn(parsed.data, meta);
}

function makeRouteHelper(
  data: unknown,
  meta: ReqMeta
): RouteHelper<"query"> & RouteHelper<"mutation"> {
  return function (schemaOrFn: any, fn: any): any {
    if (typeof schemaOrFn === "function") {
      return Promise.resolve(schemaOrFn(data, meta));
    }
    return runZod(schemaOrFn, data, meta, fn);
  } as RouteHelper<"query"> & RouteHelper<"mutation">;
}

function makeStreamHelper(data: unknown, meta: ReqMeta): StreamHelper {
  return function (schemaOrFn: any, fn: any): any {
    if (typeof schemaOrFn === "function") {
      return schemaOrFn();
    }
    return runZodStream(schemaOrFn, data, meta, fn);
  } as StreamHelper;
}

// ─── createArcModule ──────────────────────────────────────────────────────────

export interface ArcOptions {
  /** Base path for all routes. Default is `/` */
  prefix?: string;
  middleware?: Middleware[];
  modules?: readonly AnyModule[];
}

const HELPER_STUB: RouteHelper<"query"> & RouteHelper<"mutation"> = (() => {
  throw new Error("ctx.query/mutation called outside request scope");
}) as unknown as RouteHelper<"query"> & RouteHelper<"mutation">;

const STREAM_STUB: StreamHelper = (() => {
  throw new Error("ctx.stream called outside stream route scope");
}) as unknown as StreamHelper;

export type ArcModule<M extends readonly AnyModule[] = []> = ComposableModule<
  FullContext<M, ArcCtx>,
  ArcCtx
>;

export function createArcModule<const M extends readonly AnyModule[] = []>(
  transport: Transport,
  opts: Omit<ArcOptions, "modules"> & { modules?: M } = {}
): ArcModule<M> {
  const globalMiddleware = opts.middleware ?? [];
  const prefixPath = opts.prefix ?? "";

  return defineUnit({ modules: opts.modules ?? ([] as unknown as M) })({
    name: "arcx",
    boot() {
      function registerRoute<R extends Record<string, RouteEntry>>(
        routes: R,
        wrappedHandlers: WrappedRoutes,
        routeMiddleware: Record<string, Middleware[]> = {},
        routeMethods: Record<string, "GET" | "POST" | "STREAM"> = {},
        wrappedStreamHandlers: WrappedStreamRoutes = {}
      ): { ___routes: ClientRoutes<R> } {
        for (const [path, handler] of Object.entries(wrappedHandlers)) {
          const routeKey = path.includes("/") ? path.split("/")[0] : path;
          const method = routeMethods[path] ?? "GET";
          const middleware = [
            ...globalMiddleware,
            ...(routeMiddleware[routeKey] ?? []),
          ];

          const fullPath = normalizePath(prefixPath, path);

          if (method === "STREAM") {
            const streamHandler = wrappedStreamHandlers[path];
            if (streamHandler) {
              transport.registerStream(fullPath, async function* (body, meta) {
                const reqCtx: ArcCtx & { meta: ReqMeta } = {
                  transport,
                  query: HELPER_STUB,
                  mutation: HELPER_STUB,
                  stream: STREAM_STUB,
                  r: registerRoute,
                  meta,
                };

                // 4. Run the middleware chain. The final output resolves to the AsyncGenerator
                const generator = (await composeMiddleware(
                  middleware,
                  (finalData) => streamHandler(finalData, meta),
                  reqCtx,
                  body,
                  meta
                )) as AsyncGenerator<unknown>;

                // Yield the chunks safely back to the transport
                if (
                  generator &&
                  typeof generator[Symbol.asyncIterator] === "function"
                ) {
                  yield* generator;
                }
              });
            }
          } else {
            transport.register(fullPath, method, (body, meta) => {
              const reqCtx: ArcCtx & { meta: ReqMeta } = {
                transport,
                query: HELPER_STUB,
                mutation: HELPER_STUB,
                stream: STREAM_STUB,
                r: registerRoute,
                meta,
              };
              // composeMiddleware handles normal queries and mutations perfectly
              return composeMiddleware(middleware, handler, reqCtx, body, meta);
            });
          }
        }
        return {
          ___routes: buildClientProxy(
            routes,
            wrappedHandlers
          ) as ClientRoutes<R>,
        };
      }
      return {
        transport,
        query: HELPER_STUB,
        mutation: HELPER_STUB,
        stream: STREAM_STUB,
        r: registerRoute,
      };
    },
  }) as unknown as ArcModule<M>;
}

// ─── defineRoutes ─────────────────────────────────────────────────────────────

let id = 0;

export function _defineRoutes<
  const M extends readonly AnyModule[] = [],
  const Extra extends readonly AnyModule[] = []
>(
  arcModule: ArcModule<M>,
  opts: { name?: string; middleware?: Middleware[]; modules?: Extra } = {}
) {
  type Ctx = FullContext<[ArcModule<M>, ...Extra], ArcCtx>;

  function inner<R extends RoutesMap<Ctx>>(
    routes: R
  ): ComposableModule<
    Ctx & { ___routes: ClientRoutes<R> },
    { ___routes: ClientRoutes<R> }
  >;
  function inner(routes: RoutesMap<Ctx>) {
    id++;
    const moduleMiddleware = opts.middleware ?? [];
    const extraModules = (opts.modules ?? []) as readonly AnyModule[];

    const routeMiddleware = Object.fromEntries(
      Object.keys(routes).map((key) => [key, moduleMiddleware])
    );

    return defineUnit({ modules: [arcModule, ...extraModules] })({
      name: opts.name ?? `routes_${id}`,
      boot(arcCtx) {
        const ctx = arcCtx as unknown as Ctx;

        /** Probe a handler to detect query / mutation / stream. */
        function probeMethod(handler: PlainHandler): "GET" | "POST" | "STREAM" {
          let detected: "GET" | "POST" | "STREAM" = "GET";

          const trackingHelper = function () {
            detected = "GET";
            return Promise.resolve(undefined);
          } as unknown as RouteHelper<"query">;

          const mutationHelper = function () {
            detected = "POST";
            return Promise.resolve(undefined);
          } as unknown as RouteHelper<"mutation">;

          const streamHelper = function () {
            detected = "STREAM";
            return (async function* () {})();
          } as unknown as StreamHelper;

          const probeCtx = {
            ...ctx,
            query: trackingHelper,
            mutation: mutationHelper,
            stream: streamHelper,
          } as unknown as Ctx;

          try {
            handler(probeCtx, undefined);
          } catch {
            /* ignore */
          }
          return detected;
        }

        const routeMethods: Record<string, "GET" | "POST" | "STREAM"> = {};

        const { flat, flatStream } = flattenRouteMap(
          routes as Record<string, RouteEntry>,
          (path, handler) => {
            routeMethods[path] = probeMethod(handler);
            return (data: unknown, meta: ReqMeta) => {
              const helper = makeRouteHelper(data, meta);
              const reqCtx = {
                ...ctx,
                query: helper,
                mutation: helper,
                stream: STREAM_STUB,
              } as unknown as Ctx;
              return Promise.resolve(handler(reqCtx, data));
            };
          },
          (path, handler) => {
            return (data: unknown, meta: ReqMeta) => {
              const helper = makeStreamHelper(data, meta);
              const reqCtx = {
                ...ctx,
                query: HELPER_STUB,
                mutation: HELPER_STUB,
                stream: helper,
              } as unknown as Ctx;
              return handler(reqCtx, data) as AsyncGenerator<unknown>;
            };
          }
        );

        return ctx.r(
          routes as Record<string, RouteEntry>,
          flat,
          routeMiddleware,
          routeMethods,
          flatStream
        );
      },
    }) as unknown as ComposableModule<any, any>;
  }

  return inner;
}

// ─── Duplicate route detection ────────────────────────────────────────────────

export type RouteKeysOf<M> = ContextOf<M> extends { ___routes: infer R }
  ? {
      [K in keyof R]: R[K] extends (...args: any[]) => any
        ? K
        : R[K] extends Record<string, any>
        ? { [NK in keyof R[K]]: `${string & K}/${string & NK}` }[keyof R[K]]
        : never;
    }[keyof R]
  : never;

export type MarkDuplicateRoutes<
  Seen,
  T extends readonly unknown[],
  Acc extends readonly unknown[] = readonly []
> = T extends readonly [infer Head extends object, ...infer Tail]
  ? RouteKeysOf<Head> & Seen extends never
    ? MarkDuplicateRoutes<
        Seen | RouteKeysOf<Head>,
        Tail,
        readonly [...Acc, Head]
      >
    : MarkDuplicateRoutes<
        Seen | RouteKeysOf<Head>,
        Tail,
        readonly [
          ...Acc,
          `❌ Duplicate route: "${string & RouteKeysOf<Head> & Seen}"`
        ]
      >
  : Acc;

export function _createApp<const Roots extends readonly AnyModule[]>(
  roots: Roots & MarkDuplicateRoutes<never, Roots>,
  options?: StartOptions<MergeSlices<Roots>>
) {
  return start(roots as Roots, options);
}
