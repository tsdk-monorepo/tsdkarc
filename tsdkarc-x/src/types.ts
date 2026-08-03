import type { ZodType, z } from "zod";
import type { Simplify, AnyModule } from "tsdkarc";
export * from "./utils";

export type MaybePromise<T> = T | Promise<T>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. RPC Error Contract
// ─────────────────────────────────────────────────────────────────────────────

export type RpcErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL_SERVER_ERROR";

export interface RpcErrorIssue {
  path: (string | number)[];
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Transport & HTTP Escapes
// ─────────────────────────────────────────────────────────────────────────────

export interface HttpMeta {
  status?: number;
  headers?: Record<string, string>;
}

export type CreateContextFn<
  TRawReq = unknown,
  TReqCtx extends object = object
> = (req: TRawReq) => MaybePromise<TReqCtx>;

export interface TransportAdapter<TRawReq = unknown> {
  readonly name: string;
  mount(
    basePath: string,
    routeTree: RuntimeRouteTree,
    createContext: CreateContextFn<TRawReq, any>
  ): void;
  start(port: number | string, basePath: string): MaybePromise<void>;
  stop(): MaybePromise<void>;
}
// ─────────────────────────────────────────────────────────────────────────────
// 3. Middlewares & Handler Environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Environment passed into every middleware.
 * ctx  = DI-resolved app dependencies (identical to HandlerEnv.ctx, same reference).
 * meta = request-scoped data accumulated from earlier middlewares in the chain.
 */
export interface MiddlewareEnv<AppCtx extends object, TInMeta extends object> {
  ctx: AppCtx;
  meta: TInMeta;
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Value returned by `next(ext)`, and by the final middleware in the chain. */
export interface MiddlewareResult<TMeta extends object> {
  result: unknown;
  meta: TMeta;
}

/** Calls the next middleware (or the route handler) with additional meta merged in. */
export type NextFn<TInMeta extends object> = <TExt extends object>(
  ext: TExt
) => Promise<MiddlewareResult<Simplify<TInMeta & TExt>>>;

/**
 * A middleware declares only the meta it REQUIRES (TInMeta) and what it ADDS
 * (TExtMeta) — not the full meta of every builder it might run inside.
 *
 * This type is polymorphic over TFullMeta (bounded by TInMeta) so that when a
 * middleware is composed after others that added more fields, its return
 * type is computed from the ACTUAL upstream meta, not just its own declared
 * minimum requirement. Without this, a middleware declared with a narrow
 * TInMeta (e.g. `{ user: { id: string } }`) could never be `.use()`'d after
 * middlewares that already added other fields (e.g. `traceId`), because its
 * return type would only promise back the narrow slice it declared.
 */
export type Middleware<
  AppCtx extends object = object,
  TInMeta extends object = object,
  TExtMeta extends object = object
> = <TFullMeta extends TInMeta>(
  env: MiddlewareEnv<AppCtx, TFullMeta>,
  next: NextFn<TFullMeta>
) => Promise<MiddlewareResult<Simplify<TFullMeta & TExtMeta>>>;

/**
 * Folds a middleware tuple into the meta shape produced when run in order.
 * Used to compute RouteBuilder's `Meta` generic as `.use()` calls accumulate.
 */
export type FoldMiddlewares<
  Ms extends Middleware<any, any, any>[],
  Acc extends object = {}
> = Ms extends [
  Middleware<any, any, infer Ext extends object>,
  ...infer Rest extends Middleware<any, any, any>[]
]
  ? FoldMiddlewares<Rest, Simplify<Acc & Ext>>
  : Acc;

/**
 * Extracts the meta a single middleware contributes via next(ext).
 * @example type AuthExt = MiddlewareExt<typeof withAuth>; // { user: User }
 */
export type MiddlewareExt<M> = M extends Middleware<
  any,
  any,
  infer Ext extends object
>
  ? Ext
  : never;

/**
 * Extracts a middleware's declared REQUIRED meta merged with what it adds —
 * i.e. the meta shape assuming it ran against nothing but its own minimum
 * requirement. Useful for typing a downstream middleware that depends on
 * this one's output without re-declaring the shape by hand.
 * @example type AfterAuth = MiddlewareNextMeta<typeof withAuth>;
 */
export type MiddlewareNextMeta<M> = M extends Middleware<
  any,
  infer In extends object,
  infer Ext extends object
>
  ? Simplify<In & Ext>
  : never;

export interface HandlerEnv<AppCtx extends object, Meta extends object> {
  meta: Meta;
  ctx: AppCtx;
  /**
   * Serverless escape hatch. Ensures background tasks complete
   * after the HTTP response is sent.
   */
  waitUntil: (promise: Promise<unknown>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Routes & O(1) Type Caching (Phantom Types)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base definition holding pre-computed types to prevent TS2589 compilation crashes.
 * These properties never exist at runtime.
 */
export interface RouteDef<TKind extends string, TInput, TOutput> {
  _kind: TKind;
  _input?: TInput;
  _output?: TOutput;
}

export interface QueryRoute<
  TSchema extends ZodType | undefined,
  TInput,
  TOutput,
  AppCtx extends object,
  Meta extends object
> extends RouteDef<"query", TInput, TOutput> {
  schema: TSchema;
  handler: (
    input: TInput,
    env: HandlerEnv<AppCtx, Meta>
  ) => MaybePromise<TOutput>;
}

export interface MutationRoute<
  TSchema extends ZodType | undefined,
  TInput,
  TOutput,
  AppCtx extends object,
  Meta extends object
> extends RouteDef<"mutate", TInput, TOutput> {
  schema: TSchema;
  handler: (
    input: TInput,
    env: HandlerEnv<AppCtx, Meta>
  ) => MaybePromise<TOutput>;
}

export interface StreamRoute<
  TSchema extends ZodType | undefined,
  TInput,
  TChunk,
  AppCtx extends object,
  Meta extends object
> extends RouteDef<"stream", TInput, void> {
  schema: TSchema;
  _chunk?: TChunk;
  handler: (
    input: TInput,
    env: HandlerEnv<AppCtx, Meta>
  ) => AsyncGenerator<TChunk, void, unknown>;
}

export interface UploadRoute<
  TSchema extends ZodType | undefined,
  TInput,
  TOutput,
  AppCtx extends object,
  Meta extends object
> extends RouteDef<"upload", TInput, TOutput> {
  schema: TSchema;
  handler: (
    input: TInput,
    env: HandlerEnv<AppCtx, Meta>
  ) => MaybePromise<TOutput>;
}

export interface PlainRoute<
  TInput,
  TOutput,
  AppCtx extends object = any,
  Meta extends object = any
> extends RouteDef<"plain", TInput, TOutput> {
  handler: (
    input: TInput,
    env: HandlerEnv<AppCtx, Meta>
  ) => MaybePromise<TOutput>;
}

export type AnyRoute = (
  | QueryRoute<any, any, any, any, any>
  | MutationRoute<any, any, any, any, any>
  | StreamRoute<any, any, any, any, any>
  | UploadRoute<any, any, any, any, any>
  | PlainRoute<any, any>
) & {
  ___routeMiddlewares?: Middleware<any, any, any>[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Route Builder API
// ─────────────────────────────────────────────────────────────────────────────

// 1. Add the Flat utility.
// The `& {}` trick is critical: it forces TypeScript to instantly resolve
// the object shape and discard the Zod generic baggage.
export type Flat<T> = T extends Record<string, any>
  ? { [K in keyof T]: T[K] } & {}
  : T;

export interface RouteBuilder<AppCtx extends object, Meta extends object> {
  /**
   * Adds a middleware. TypeScript checks that the middleware's required
   * input meta (TInMeta) is satisfied by the builder's current Meta — no
   * hack needed since `use` is declared as a function-typed property
   * (strict, contravariant parameter checking applies).
   */
  use: <TReq extends object, TExt extends object>(
    mw: Middleware<AppCtx, TReq, TExt> & (Meta extends TReq ? unknown : never)
  ) => RouteBuilder<AppCtx, Simplify<Meta & TExt>>;

  // --- QUERY / MUTATION / STREAM / UPLOAD unchanged below ---
  query<TInput, TOutput>(
    handler: (
      input: TInput,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): QueryRoute<undefined, TInput, TOutput, AppCtx, Meta>;

  query<TSchema extends ZodType, TOutput>(
    schema: TSchema,
    handler: (
      input: Flat<z.infer<TSchema>>,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): QueryRoute<TSchema, Flat<z.input<TSchema>>, TOutput, AppCtx, Meta>;

  mutate<TInput, TOutput>(
    handler: (
      input: TInput,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): MutationRoute<undefined, TInput, TOutput, AppCtx, Meta>;

  mutate<TSchema extends ZodType, TOutput>(
    schema: TSchema,
    handler: (
      input: Flat<z.infer<TSchema>>,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): MutationRoute<TSchema, Flat<z.input<TSchema>>, TOutput, AppCtx, Meta>;

  stream<TInput, TChunk>(
    handler: (
      input: TInput,
      env: HandlerEnv<AppCtx, Meta>
    ) => AsyncGenerator<TChunk, void, unknown>
  ): StreamRoute<undefined, TInput, TChunk, AppCtx, Meta>;

  stream<TSchema extends ZodType, TChunk>(
    schema: TSchema,
    handler: (
      input: Flat<z.infer<TSchema>>,
      env: HandlerEnv<AppCtx, Meta>
    ) => AsyncGenerator<TChunk, void, unknown>
  ): StreamRoute<TSchema, Flat<z.input<TSchema>>, TChunk, AppCtx, Meta>;

  upload<TInput, TOutput>(
    handler: (
      input: TInput,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): UploadRoute<undefined, TInput, TOutput, AppCtx, Meta>;

  upload<TSchema extends ZodType, TOutput>(
    schema: TSchema,
    handler: (
      input: Flat<z.infer<TSchema>>,
      env: HandlerEnv<AppCtx, Meta>
    ) => MaybePromise<TOutput>
  ): UploadRoute<TSchema, Flat<z.input<TSchema>>, TOutput, AppCtx, Meta>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tree Types & Client Extraction
// ─────────────────────────────────────────────────────────────────────────────

export type PlainHandlerFn = (...args: any[]) => any;

export type RawRouteDict = {
  [key: string]: AnyRoute | PlainHandlerFn | RawRouteDict;
};

export type NormaliseEntry<V> = V extends AnyRoute
  ? V
  : V extends PlainHandlerFn
  ? PlainRoute<Parameters<V>[0], Awaited<ReturnType<V>>>
  : V extends RawRouteDict
  ? NormaliseRouteDict<V>
  : never;

export type NormaliseRouteDict<T extends RawRouteDict> = {
  [K in keyof T]: NormaliseEntry<T[K]>;
};

export type RuntimeRouteTree = {
  [key: string]: AnyRoute | RuntimeRouteTree;
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. RouteTreeModule — replaces the unsafe ___isRouteTreeModule: true pattern
//
// Previously, defineRouter used `(routeMod as any).___isRouteTreeModule = true`
// to tag modules at runtime, then relied on `appCtx[val.name]` with an optional
// name that could silently be undefined.
//
// Now:
//   - RouteTreeModule is a typed wrapper that carries _mod (the real DI module)
//     and ___moduleName (always a string, auto-generated internally).
//   - extractRouteModules reads ._mod instead of the module itself.
//   - buildRuntimeTree reads appCtx[val.___moduleName] with an explicit error
//     if the key is missing.
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteTreeModule<TRoutes> {
  /** Discriminant — checked by isRouteTreeModule() at runtime. */
  readonly ___isRouteTreeModule: true;
  /** Auto-generated unique name used as the DI context key. */
  readonly ___moduleName: string;
  /** Phantom type only — never exists at runtime. */
  readonly ___type_routes: TRoutes;
  /** The underlying DI module produced by defineModule().init(). */
  readonly _mod: AnyModule;
}

/** Runtime type guard for RouteTreeModule. Use instead of checking ___isRouteTreeModule directly. */
export function isRouteTreeModule(val: unknown): val is RouteTreeModule<any> {
  return (
    typeof val === "object" &&
    val !== null &&
    (val as any).___isRouteTreeModule === true
  );
}

export type RouteFactoryTree = {
  [key: string]: RouteTreeModule<any> | RouteFactoryTree;
};

export type InferRouteTree<T> = T extends RouteTreeModule<infer R>
  ? R
  : T extends object
  ? { [K in keyof T]: InferRouteTree<T[K]> }
  : never;

/** Extracts the final AppRoutes type for the frontend client */
export type RoutesOf<T extends { routes: any } | Promise<{ routes: any }>> =
  Awaited<T>["routes"];

/**
 * Recursively flattens intersected object types for readable hover/IDE types.
 * Functions are returned as-is (not recursed into) — a function is
 * technically `object` in TS, but mapping over it drops the call signature,
 * collapsing e.g. `(id: string) => User` down to `{}`.
 */
export type DeepFlat<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
  ? { [K in keyof T]: DeepFlat<T[K]> }
  : T;
