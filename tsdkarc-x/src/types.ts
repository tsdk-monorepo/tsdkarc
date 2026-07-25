import type { ZodType, z } from "zod";
import type { Simplify, AnyModule } from "tsdkarc";

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

export class RpcError extends Error {
  public readonly name = "RpcError";
  constructor(
    public code: RpcErrorCode,
    public message: string,
    public issues?: RpcErrorIssue[]
  ) {
    super(message);
    Object.setPrototypeOf(this, RpcError.prototype);
  }
}

export function isRpcError(error: unknown): error is RpcError {
  return error instanceof Error && error.name === "RpcError";
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Transport & HTTP Escapes
// ─────────────────────────────────────────────────────────────────────────────

export interface HttpMeta {
  status?: number;
  headers?: Record<string, string>;
}

export class HttpResponse<T> {
  constructor(public readonly body: T, public readonly meta: HttpMeta = {}) {}
}

export const HTTP = {
  send<T>(body: T, meta: HttpMeta = {}): HttpResponse<T> {
    return new HttpResponse(body, meta);
  },
  redirect(
    url: string,
    status: 301 | 302 | 307 | 308 = 302
  ): HttpResponse<never> {
    return new HttpResponse<never>(undefined as never, {
      status,
      headers: { Location: url },
    });
  },
};

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
  start(port: number, basePath: string): MaybePromise<void>;
  stop(): MaybePromise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Middlewares & Handler Environment
// ─────────────────────────────────────────────────────────────────────────────

export type NextFn<TInCtx extends object, TExt extends object> = (
  ext: TExt
) => Promise<{ result: unknown; ctx: Simplify<TInCtx & TExt> }>;

export type Middleware<
  TInCtx extends object = object,
  TExtCtx extends object = object
> = (
  inCtx: TInCtx,
  next: NextFn<TInCtx, TExtCtx>
) => Promise<{ result: unknown; ctx: Simplify<TInCtx & TExtCtx> }>;

export type FoldMiddlewares<
  Ms extends Middleware<any, any>[],
  Acc extends object = {}
> = Ms extends [
  Middleware<any, infer Ext extends object>,
  ...infer Rest extends Middleware<any, any>[]
]
  ? FoldMiddlewares<Rest, Simplify<Acc & Ext>>
  : Acc;

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
  ___routeMiddlewares?: Middleware<any, any>[];
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
  use<TIn extends object, TExt extends object>(
    mw: Middleware<TIn, TExt> & (Meta extends TIn ? unknown : never)
  ): RouteBuilder<AppCtx, Simplify<Meta & TExt>>;

  // --- QUERY ---
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
  ): QueryRoute<TSchema, Flat<z.infer<TSchema>>, TOutput, AppCtx, Meta>;

  // --- MUTATION ---
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
  ): MutationRoute<TSchema, Flat<z.infer<TSchema>>, TOutput, AppCtx, Meta>;

  // --- STREAM ---
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
  ): StreamRoute<TSchema, Flat<z.infer<TSchema>>, TChunk, AppCtx, Meta>;

  // --- UPLOAD ---
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
  ): UploadRoute<TSchema, Flat<z.infer<TSchema>>, TOutput, AppCtx, Meta>;
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

export type DeepFlat<T> = T extends object
  ? { [K in keyof T]: DeepFlat<T[K]> }
  : T;
