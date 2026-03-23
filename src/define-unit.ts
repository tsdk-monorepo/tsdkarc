import {
  defineModule,
  type AnyModule,
  type Module,
  type FullContext,
  type MergeSlices,
} from "./define-module";

// ─── ComposableModule ─────────────────────────────────────────────────────────

export type ComposableModule<S extends object, Sl extends object = S> = Module<
  S,
  Sl
> & {
  add<const Extra extends readonly AnyModule[]>(
    extra: Extra
  ): ComposableModule<S & MergeSlices<Extra>, Sl>;
};

export function makeComposable<S extends object, Sl extends object>(
  mod: Module<S, Sl>
): ComposableModule<S, Sl> {
  const composable = mod as ComposableModule<S, Sl>;
  composable.add = function <const Extra extends readonly AnyModule[]>(
    extra: Extra
  ): ComposableModule<S & MergeSlices<Extra>, Sl> {
    const merged = defineModule()({
      name: `${mod.name}__composed`,
      modules: [mod, ...extra] as const,
      boot() {},
    });
    return makeComposable(
      merged as unknown as Module<S & MergeSlices<Extra>, Sl>
    );
  };
  return composable;
}

// ─── defineModule ─────────────────────────────────────────────────────────────

/**
 * Curried defineModule — mirrors defineRoutes API.
 * First call fixes Deps (const inferred, no `as const` needed).
 * Second call provides the module definition with fully typed ctx.
 *
 * @example
 * // No deps:
 * const configModule = defineModule()({
 *   name: "config",
 *   boot: () => ({ config: { url: process.env.DATABASE_URL } }),
 * });
 *
 * // With deps — no `as const` needed:
 * const dbModule = defineModule({ modules: [configModule] })({
 *   name: "db",
 *   boot: (ctx) => ({ db: new PrismaClient(ctx.config.url) }),
 * });
 *
 * // .add() composition:
 * const extended = dbModule.add([stripeModule]);
 */
export function defineUnit<const Deps extends readonly AnyModule[] = []>(
  opts: { modules?: Deps } = {}
) {
  type Ctx = MergeSlices<Deps>;

  return function <
    Slice extends Record<string, unknown> = Record<never, never>
  >(def: {
    name: string;
    description?: string;
    boot?(ctx: Ctx): void | Promise<void> | Slice | Promise<Slice>;
    shutdown?(ctx: Ctx & Slice): void | Promise<void>;
    beforeBoot?(ctx: Ctx): void | Promise<void>;
    afterBoot?(ctx: Ctx & Slice): void | Promise<void>;
    beforeShutdown?(ctx: Ctx & Slice): void | Promise<void>;
    afterShutdown?(ctx: Ctx & Slice): void | Promise<void>;
  }): ComposableModule<FullContext<Deps, Slice>, Slice> {
    const mod = defineModule()({
      ...def,
      modules: (opts.modules ?? []) as unknown as Deps,
    } as any);

    return makeComposable(
      mod as unknown as Module<FullContext<Deps, Slice>, Slice>
    );
  };
}
