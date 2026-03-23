import {
  defineModule,
  type AnyModule,
  type Module,
  type MergeSlices,
  type SliceOf,
} from "./define-module";
import { defineUnit, type ComposableModule } from "./define-unit";

// ─── Type helpers ─────────────────────────────────────────────────────────────

/** K exists in Ctx → true, else false. */
export type HasKey<Ctx, K extends string> = K extends keyof Ctx ? true : false;

/** Conflicting keys between two units — never if clean. */
export type OverlapsWith<
  A extends AnyModule,
  B extends AnyModule
> = keyof SliceOf<A> & keyof SliceOf<B>;

/** Compile error if A and B share any key. */
export type AssertNoOverlap<
  A extends AnyModule,
  B extends AnyModule
> = OverlapsWith<A, B> extends never
  ? true
  : `❌ Key conflict: "${string & OverlapsWith<A, B>}" exists in both modules`;

// ─── mergeUnits ───────────────────────────────────────────────────────────────

/**
 * Combine multiple units into one named unit.
 *
 * @example
 * const app = mergeUnits("app", [dbUnit, authUnit, stripeUnit]);
 */
export function mergeUnits<const M extends readonly AnyModule[]>(
  name: string,
  modules: M
): ComposableModule<MergeSlices<M>, Record<never, never>> {
  return defineUnit({ modules })({
    name,
    boot() {},
  }) as unknown as ComposableModule<MergeSlices<M>, Record<never, never>>;
}

// ─── optional ────────────────────────────────────────────────────────────────

/**
 * Swallow boot errors — app continues without this unit.
 * Use for non-critical integrations (analytics, monitoring).
 *
 * @example
 * const sentry = optional(sentryUnit);
 */
export function optional<M extends AnyModule>(unit: M): M {
  return {
    ...unit,
    async boot(ctx: any) {
      try {
        return await unit.boot?.(ctx);
      } catch (err) {
        console.warn(`[optional] "${unit.name}" boot failed — skipping:`, err);
        return undefined;
      }
    },
  } as unknown as M;
}

// ─── lazy ─────────────────────────────────────────────────────────────────────

/**
 * Defer module import until boot time.
 *
 * @example
 * const heavy = lazy("heavy", () => import("./heavy").then(m => m.heavyUnit));
 */
export function lazy<S extends object, Sl extends object>(
  name: string,
  load: () => Promise<Module<S, Sl>>
): ComposableModule<S, Sl> {
  let resolved: Module<S, Sl> | null = null;

  return defineModule()({
    name,
    async boot(ctx) {
      resolved = await load();
      return resolved.boot?.(ctx as any) as any;
    },
    async shutdown(ctx) {
      return resolved?.shutdown?.(ctx as any);
    },
    async beforeBoot(ctx) {
      return resolved?.beforeBoot?.(ctx as any);
    },
    async afterBoot(ctx) {
      return resolved?.afterBoot?.(ctx as any);
    },
    async beforeShutdown(ctx) {
      return resolved?.beforeShutdown?.(ctx as any);
    },
    async afterShutdown(ctx) {
      return resolved?.afterShutdown?.(ctx as any);
    },
  }) as unknown as ComposableModule<S, Sl>;
}

// ─── mock ─────────────────────────────────────────────────────────────────────

/**
 * Replace a unit's boot with a mock slice — for testing.
 *
 * @example
 * const mockDb = mock(dbUnit, { db: { find: vi.fn() } });
 */
export function mock<M extends AnyModule>(unit: M, slice: SliceOf<M>): M {
  return {
    ...unit,
    boot: () => slice,
    shutdown: undefined,
    beforeBoot: undefined,
    afterBoot: undefined,
    beforeShutdown: undefined,
    afterShutdown: undefined,
  } as unknown as M;
}

// ─── pipe ─────────────────────────────────────────────────────────────────────

/**
 * Merge units left-to-right into one.
 *
 * @example
 * const app = pipe(configUnit, dbUnit, authUnit);
 */
export function pipe<const M extends readonly AnyModule[]>(
  ...units: M
): ComposableModule<MergeSlices<M>, Record<never, never>> {
  return mergeUnits(`pipe__${units.map((u) => u.name).join("_")}`, units);
}

// helpers.ts

/**
 * Compile-time check that no two modules share a context key.
 * Pass the modules tuple — duplicate keys produce a named compile error.
 *
 * @example
 * start(checkConflicts([dbUnit, authUnit, stripeUnit]), options);
 * // @ts-expect-error — "db" conflict:
 * start(checkConflicts([dbUnit, dbUnit2]), options);
 */
export type MarkConflictingUnits<
  Seen,
  T extends readonly unknown[],
  Acc extends readonly unknown[] = readonly []
> = T extends readonly [infer Head extends AnyModule, ...infer Tail]
  ? keyof SliceOf<Head> & Seen extends never
    ? MarkConflictingUnits<
        Seen | keyof SliceOf<Head>,
        Tail,
        readonly [...Acc, Head]
      >
    : MarkConflictingUnits<
        Seen | keyof SliceOf<Head>,
        Tail,
        readonly [
          ...Acc,
          `❌ Key conflict: "${string &
            keyof SliceOf<Head> &
            Seen}" already owned`
        ]
      >
  : Acc;

export function checkConflicts<const T extends readonly AnyModule[]>(
  modules: T & MarkConflictingUnits<never, T>
): T {
  return modules;
}
