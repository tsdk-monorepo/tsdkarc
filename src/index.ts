/**
 * tsdkarc.ts
 *
 * Minimal module lifecycle manager.
 *
 * Exports: Module, defineModule, ContextWriter, LifecycleHooks, StartOptions, start.
 *
 * Type helpers (internal):
 *   UnionToIntersection<U>  — U1 | U2 | U3  →  U1 & U2 & U3
 *   SliceOf<M>              — extracts S (full context) from Module<S, Sl>
 *   MergeSlices<Tuple>      — intersects all S from a modules tuple
 *   FullContext<Deps, Own>  — MergeSlices<Deps> & Own
 *
 * Internal functions use AnyModule (Module<object, object>) at boundaries
 * where generic params are intentionally erased — the runtime does not need them.
 */

// ---------------------------------------------------------------------------
// ContextWriter
// ---------------------------------------------------------------------------

/**
 * ContextWriter<S, Sl>
 *
 * Reading  — direct property access on Readonly<S>:  ctx.db, ctx.config
 * Writing  — set() restricted to OwnSlice keys only: ctx.set('auth', ...)
 *
 * Readonly<S> prevents ctx.db = ... at the type level.
 * Attempting to write a dep key via set() is also a type error.
 *
 * Note: 'set' is a reserved key — no slice may use 'set' as a property name.
 */
export type ContextWriter<
  S extends object,
  Sl extends object = S
> = Readonly<S> & {
  set<K extends Exclude<keyof Sl, "set">>(key: K, value: Sl[K]): void;
  set(ctx: Sl): void;
};

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Converts U1 | U2 | U3 into U1 & U2 & U3 via contravariance. */
type UnionToIntersection<U> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (U extends any ? (x: U) => void : never) extends (x: infer I) => void
    ? I
    : never;

/** Extracts full context S from a Module — so transitive deps propagate upward. */
type SliceOf<M> = M extends Module<infer S, object> ? S : never;

/** Merges full context S from all modules in a tuple into one intersection. */
type MergeSlices<T extends readonly AnyModule[]> = UnionToIntersection<
  SliceOf<T[number]>
> extends object
  ? UnionToIntersection<SliceOf<T[number]>>
  : Record<never, never>;

/** Full context seen by a module = all deps merged context + own slice. */
type FullContext<
  Deps extends readonly AnyModule[],
  Own extends object
> = MergeSlices<Deps> & Own;

/** Opaque alias used at internal boundaries where generic params are erased. */
type AnyModule = Module<object, object>;

// ---------------------------------------------------------------------------
// LifecycleHooks
// ---------------------------------------------------------------------------

/**
 * Global lifecycle hooks for start().
 *
 * Each fires exactly once — not per-module:
 *   beforeBoot     — before the first module boots
 *   afterBoot      — after the last module has booted
 *   beforeShutdown — before the first module shuts down
 *   afterShutdown  — after the last module has shut down
 *
 * Per-module variants (beforeEach*, afterEach*) fire once per module,
 * in boot/shutdown order, with the current module passed as the second argument.
 */
export interface LifecycleHooks<S extends object = Record<never, never>> {
  /** Called once before the first module begins booting. */
  beforeBoot?(ctx: ContextWriter<S>): Promise<void> | void;

  /** Called once after the last module has finished booting. */
  afterBoot?(ctx: ContextWriter<S>): Promise<void> | void;

  /** Called once before the first module begins shutting down. */
  beforeShutdown?(ctx: ContextWriter<S>): Promise<void> | void;

  /** Called once after the last module has finished shutting down. */
  afterShutdown?(ctx: ContextWriter<S>): Promise<void> | void;

  /** Called before each individual module boots, in boot order. */
  beforeEachBoot?(
    ctx: ContextWriter<S>,
    module: Module<any>
  ): Promise<void> | void;

  /** Called after each individual module finishes booting, in boot order. */
  afterEachBoot?(
    ctx: ContextWriter<S>,
    module: Module<any>
  ): Promise<void> | void;

  /** Called before each individual module shuts down, in shutdown order. */
  beforeEachShutdown?(
    ctx: ContextWriter<S>,
    module: Module<any>
  ): Promise<void> | void;

  /** Called after each individual module finishes shutting down, in shutdown order. */
  afterEachShutdown?(
    ctx: ContextWriter<S>,
    module: Module<any>
  ): Promise<void> | void;

  onError?(
    error: Error,
    ctx: ContextWriter<S>,
    module: Module<any>
  ): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

/**
 * Module<S, Sl>
 *
 * Per-module hooks fire scoped to this module's own boot/shutdown.
 * They receive ContextWriter<S, Sl> — same as boot/shutdown.
 */
export interface Module<S extends object, Sl extends object = S> {
  name: string;
  description?: string;
  modules?: AnyModule[];
  boot?(ctx: ContextWriter<S, Sl>): Promise<void> | void | Sl | Promise<Sl>;
  shutdown?(ctx: ContextWriter<S, Sl>): Promise<void> | void;
  /** Called immediately before this module's own boot(). */
  beforeBoot?(ctx: ContextWriter<S, Sl>): Promise<void> | void;
  /** Called immediately after this module's own boot(). */
  afterBoot?(ctx: ContextWriter<S, Sl>): Promise<void> | void;
  /** Called immediately before this module's own shutdown(). */
  beforeShutdown?(ctx: ContextWriter<S, Sl>): Promise<void> | void;
  /** Called immediately after this module's own shutdown(). */
  afterShutdown?(ctx: ContextWriter<S, Sl>): Promise<void> | void;
}

/**
 * Extracts the full context type from a module.
 *
 * @example
 * type AContext = ContextOf<typeof moduleA> // { value: string }
 */
export type ContextOf<M> = M extends Module<infer Full, any>
  ? { [K in keyof Full]: Full[K] }
  : never;

/** Get ContextWriter type by typeof module. */
export type ContextWriterOf<M> = ContextWriter<
  M extends Module<any, infer Ctx> ? Ctx : never
>;

/** Get the `set` function type from a module's ContextWriter. */
export type SetOf<M> = ContextWriterOf<M>["set"];

// ---------------------------------------------------------------------------
// defineModule
// ---------------------------------------------------------------------------

/**
 * Errors if U has any key not in T by mapping extra keys to never.
 */
type Exact<T, U> = { [K in keyof U]: K extends keyof T ? T[K] : never };

/**
 * Produces a readable type error message instead of `never`.
 * Msg appears directly in the IDE error output.
 */
type TypeError<Msg extends string> = { readonly __error__: Msg };

/**
 * Errors if OwnSlice declares a key that already exists in DepCtx.
 * Overlapping keys show a readable message instead of `never`.
 */
type NoOverlap<DepCtx, OwnSlice> = {
  [K in keyof OwnSlice]: K extends keyof DepCtx
    ? TypeError<`Key "${K & string}" is already owned by a dependency module`>
    : OwnSlice[K];
};

/**
 * Module def shape when OwnSlice is explicitly provided.
 */
type ModuleDef<
  Deps extends readonly AnyModule[],
  OwnSlice extends object,
  R extends object
> = {
  name: string;
  description?: string;
  modules?: Deps;
  boot?(
    ctx: ContextWriter<
      FullContext<Deps, OwnSlice>,
      NoOverlap<MergeSlices<Deps>, OwnSlice>
    >
  ):
    | void
    | Promise<void>
    | (R & Exact<NoOverlap<MergeSlices<Deps>, OwnSlice>, R>)
    | Promise<R & Exact<NoOverlap<MergeSlices<Deps>, OwnSlice>, R>>;
  shutdown?(
    ctx: ContextWriter<FullContext<Deps, OwnSlice>, OwnSlice>
  ): Promise<void> | void;
  beforeBoot?(
    ctx: ContextWriter<FullContext<Deps, OwnSlice>, OwnSlice>
  ): Promise<void> | void;
  afterBoot?(
    ctx: ContextWriter<FullContext<Deps, OwnSlice>, OwnSlice>
  ): Promise<void> | void;
  beforeShutdown?(
    ctx: ContextWriter<FullContext<Deps, OwnSlice>, OwnSlice>
  ): Promise<void> | void;
  afterShutdown?(
    ctx: ContextWriter<FullContext<Deps, OwnSlice>, OwnSlice>
  ): Promise<void> | void;
};

/**
 * Module def shape when OwnSlice is inferred from boot's return type.
 *
 * Deps and Slice are independent generics — TypeScript infers Deps from the
 * `modules` field and Slice from boot's return value in a single pass, with
 * no mutual dependency between them.
 *
 * Hook ctx types:
 *   boot      — ContextWriter<MergeSlices<Deps>>  (dep context only)
 *               boot produces Slice, so Slice cannot appear in its own param
 *               type without creating a cycle that collapses ctx to `any`.
 *   all other — ContextWriter<FullContext<Deps, Slice>, Slice>
 *               these run after boot has written Slice into context, so the
 *               full context including own slice is available and safe to type.
 */
type ModuleDefInfer<
  Deps extends readonly AnyModule[],
  Slice extends Record<string, unknown>
> = {
  name: string;
  description?: string;
  modules?: Deps;
  /** ctx = dep context only — own slice not available (produced by this function). */
  boot?(
    ctx: ContextWriter<MergeSlices<Deps>, MergeSlices<Deps>>
  ): void | Promise<void> | Slice | Promise<Slice>;
  /** ctx = full context including own slice — runs after boot. */
  shutdown?(
    ctx: ContextWriter<FullContext<Deps, Slice>, Slice>
  ): Promise<void> | void;
  /** ctx = dep context only — runs before boot. */
  beforeBoot?(
    ctx: ContextWriter<MergeSlices<Deps>, MergeSlices<Deps>>
  ): Promise<void> | void;
  /** ctx = full context including own slice — runs after boot. */
  afterBoot?(
    ctx: ContextWriter<FullContext<Deps, Slice>, Slice>
  ): Promise<void> | void;
  /** ctx = full context including own slice — runs after boot. */
  beforeShutdown?(
    ctx: ContextWriter<FullContext<Deps, Slice>, Slice>
  ): Promise<void> | void;
  /** ctx = full context including own slice — runs after boot. */
  afterShutdown?(
    ctx: ContextWriter<FullContext<Deps, Slice>, Slice>
  ): Promise<void> | void;
};

/**
 * Sentinel type used to detect whether OwnSlice was explicitly supplied.
 * When defineModule() is called with no type argument, OwnSlice defaults to
 * this value, triggering the infer-from-boot path.
 */
declare const INFER: unique symbol;
type Infer = typeof INFER;

/**
 * Selects the inner function signature based on whether OwnSlice was supplied.
 *
 * OwnSlice = Infer (no type arg given):
 *   Deps is inferred from `modules`. Slice is inferred from boot's return.
 *   Both are independent generics — no cycle, no `any`.
 *   boot ctx = dep context only (cycle prevention).
 *   all other hook ctx = full context including own slice.
 *
 * OwnSlice = explicit type:
 *   Enforces boot return against the supplied OwnSlice via Exact/NoOverlap.
 *   Unchanged from original — no regression.
 */
type DefineModuleInner<OwnSlice> = OwnSlice extends Infer
  ? <
      const Deps extends readonly AnyModule[],
      Slice extends Record<string, unknown> = Record<never, never>
    >(
      def: ModuleDefInfer<Deps, Slice>
    ) => Module<FullContext<Deps, Slice>, Slice>
  : OwnSlice extends object
  ? <
      const Deps extends readonly AnyModule[],
      R extends NoOverlap<MergeSlices<Deps>, OwnSlice>
    >(
      def: ModuleDef<Deps, OwnSlice, R>
    ) => Module<FullContext<Deps, OwnSlice>, OwnSlice>
  : never;

/**
 * Defines a module with optional dependency wiring and lifecycle hooks.
 *
 * Explicit OwnSlice — boot return is enforced against the supplied type:
 *   defineModule<{ count: number }>()({ name: "counter", boot: () => ({ count: 0 }) })
 *
 * Inferred OwnSlice — Deps inferred from modules, OwnSlice inferred from boot return.
 * ctx types per hook:
 *   boot        — dep context only (own slice is being produced here, not available yet)
 *   shutdown    — full context including own slice
 *   beforeBoot  — dep context only (own slice not yet written)
 *   afterBoot   — full context including own slice
 *   beforeShutdown / afterShutdown — full context including own slice
 *
 * Void / absent boot — OwnSlice becomes Record<never, never>:
 *   defineModule()({ name: "logger", boot: () => { console.log("up") } })
 */
export function defineModule<OwnSlice = Infer>(): DefineModuleInner<OwnSlice> {
  return function (def: unknown): Module<any, any> {
    return def as Module<any, any>;
  } as DefineModuleInner<OwnSlice>;
}

// ---------------------------------------------------------------------------
// StartOptions
// ---------------------------------------------------------------------------

/**
 * Options for start(). Flat intersection — no nesting required:
 *   start([db], { log, afterBoot: async (ctx) => ... })
 *
 * S is inferred from the roots tuple — no explicit type param needed.
 */
export type StartOptions<S extends object = Record<never, never>> =
  LifecycleHooks<S>;

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Boot all modules reachable from roots, in dependency order.
 * Deduplicates by name across the entire tree — pass only roots.
 * Returns stop() for graceful shutdown. stop() is idempotent.
 *
 * Context type is inferred from the roots tuple automatically.
 *
 * Global hook order:
 *   beforeBoot → [each: beforeBoot → boot → afterBoot] → afterBoot
 *   beforeShutdown → [each: beforeShutdown → shutdown → afterShutdown] → afterShutdown
 *
 * Global hooks do NOT fire during rollback — rollback is error recovery.
 *
 * Throws if:
 *   - same name resolves to two different instances (collision)
 *   - a circular dependency is detected
 *   - any boot() fails (already-booted modules are rolled back)
 *
 * @param roots    root Module instances — tree walked recursively
 * @param options  optional log + global lifecycle hooks
 */
export default async function start<const Roots extends readonly AnyModule[]>(
  roots: Roots,
  options: StartOptions<MergeSlices<Roots>> = {}
): Promise<{ stop(): Promise<void>; ctx: MergeSlices<Roots> }> {
  const {
    beforeBoot,
    afterBoot,
    beforeShutdown,
    afterShutdown,
    beforeEachBoot,
    afterEachBoot,
    beforeEachShutdown,
    afterEachShutdown,
    onError,
  } = options;

  const ctx: Record<string, unknown> = {};
  const writer = makeWriter(ctx) as unknown as ContextWriter<
    MergeSlices<Roots>
  >;
  const modWriter = writer as unknown as ContextWriter<object, object>;
  const booted: AnyModule[] = [];
  let stopped = false;

  const sorted = resolveModules([...roots]);

  async function doStop() {
    if (stopped) return;
    stopped = true;

    await beforeShutdown?.(writer);
    const reverseBoot = [...booted].reverse();

    for (const mod of reverseBoot) {
      try {
        await mod.beforeShutdown?.(modWriter);
      } catch (err) {
        const error = new Error(
          `Module "${mod.name}" beforeShutdown failed: ${errorMessage(err)}`
        );
        if (onError) {
          await onError?.(error, writer, mod);
        } else {
          throw error;
        }
      }
    }

    for (const mod of reverseBoot) {
      try {
        await beforeEachShutdown?.(writer, mod);
        await mod.shutdown?.(modWriter);
        await afterEachShutdown?.(writer, mod);
      } catch (err) {
        const error = new Error(
          `Module "${mod.name}" stop failed: ${errorMessage(err)}`
        );
        if (onError) {
          await onError?.(error, writer, mod);
        } else {
          throw error;
        }
      }
    }

    for (const mod of reverseBoot) {
      try {
        await mod.afterShutdown?.(modWriter);
      } catch (err) {
        const error = new Error(
          `Module "${mod.name}" afterShutdown failed: ${errorMessage(err)}`
        );
        if (onError) {
          await onError?.(error, writer, mod);
        } else {
          throw error;
        }
      }
    }

    await afterShutdown?.(writer);
  }

  await beforeBoot?.(writer);

  for (const mod of sorted) {
    try {
      await beforeEachBoot?.(writer, mod);
      await mod.beforeBoot?.(modWriter);
      const modCtx = await mod.boot?.(modWriter);
      if (modCtx) modWriter.set(modCtx);
      await afterEachBoot?.(writer, mod);
      await mod.afterBoot?.(modWriter);
      booted.push(mod);
    } catch (err) {
      stopped = true;
      await rollback(booted, modWriter);
      const error = new Error(
        `Module "${mod.name}" boot failed: ${errorMessage(err)}`
      );
      if (onError) {
        await onError?.(error, writer, mod);
      } else {
        throw error;
      }
    }
  }

  await afterBoot?.(writer);

  return { stop: doStop, ctx: modWriter as unknown as MergeSlices<Roots> };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk the module tree from roots, dedupe by name, topoSort.
 * Throws on name collision (same name, different instance).
 */
export function resolveModules(roots: AnyModule[]): AnyModule[] {
  const registry = new Map<string, AnyModule>();

  function collect(mod: AnyModule) {
    const existing = registry.get(mod.name);
    if (existing) {
      if (existing !== mod) {
        throw new Error(
          `Module name collision: "${mod.name}" registered with two different instances`
        );
      }
      return;
    }
    registry.set(mod.name, mod);
    for (const dep of mod.modules ?? []) collect(dep);
  }

  for (const root of roots) collect(root);
  return topoSort(registry);
}

/**
 * DFS topological sort over the registry.
 * Throws on circular dependency.
 */
export function topoSort(registry: Map<string, AnyModule>): AnyModule[] {
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: AnyModule[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    if (inStack.has(name))
      throw new Error(`Circular dependency detected at: "${name}"`);

    const mod = registry.get(name);
    if (!mod) return;

    inStack.add(name);
    for (const dep of mod.modules ?? []) visit(dep.name);
    inStack.delete(name);
    visited.add(name);
    order.push(mod);
  }

  for (const name of registry.keys()) visit(name);
  return order;
}

/**
 * Shut down already-booted modules in reverse order.
 * Best-effort: logs errors, never throws.
 * Global beforeShutdown/afterShutdown do NOT fire — rollback is error recovery.
 */
export async function rollback(
  booted: AnyModule[],
  modWriter: ContextWriter<object, object>
) {
  for (const mod of [...booted].reverse()) {
    try {
      await mod.beforeShutdown?.(modWriter);
      await mod.shutdown?.(modWriter);
      await mod.afterShutdown?.(modWriter);
    } catch (err) {
      throw new Error(
        `Module "${mod.name}" rollback_shutdown_failed: ${errorMessage(err)}`
      );
    }
  }
}

/**
 * ContextWriter backed by a plain Record.
 * Direct property access for reads (via Proxy), set() for writes.
 * Cast to ContextWriter<S> at the start() boundary.
 */
function makeWriter(
  ctx: Record<string, unknown>
): ContextWriter<Record<string, unknown>> {
  return Object.assign(ctx, {
    set(keyOrCtx: string | Record<string, unknown>, value: unknown) {
      if (typeof keyOrCtx === "object") {
        return Object.assign(ctx, { ...keyOrCtx, set: ctx.set });
      }
      if (keyOrCtx !== "set") {
        ctx[keyOrCtx] = value;
      }
      return ctx;
    },
  }) as unknown as ContextWriter<Record<string, unknown>>;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
