import {
  ref,
  computed,
  watch,
  onScopeDispose,
  toValue,
  type Ref,
  type MaybeRefOrGetter,
} from "vue";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryReturnType,
  type UseQueryOptions,
  type UseMutationReturnType,
  type UseMutationOptions,
} from "@tanstack/vue-query";

// ─── Stream state ─────────────────────────────────────────────────────────────

/**
 * Reactive stream state. Each field is its own Ref so it stays reactive
 * even when destructured at the call site (e.g. `const { chunks, done } = ...`).
 */
export type VQStreamState<C> = {
  chunks: Ref<C[]>;
  latest: Ref<C | undefined>;
  done: Ref<boolean>;
  error: Ref<Error | undefined>;
};

// ─── Runtime proxy utils ──────────────────────────────────────────────────────

type ProxyCache = Map<string, any>;

/**
 * Single source of truth for path formatting. Reused for both the proxy's
 * internal memoization key and the Vue Query cache key, so path formatting
 * never has to be changed in two places.
 * @param path  string[]
 */
function pathKey(path: string[]) {
  return path.join("/");
}

/**
 * Walks a dotted property path on the client object.
 * @param client root client object
 * @param path property path, e.g. ["user", "get"]
 * @returns node at the path, or undefined if any segment is missing
 */
function resolveNode(client: any, path: string[]) {
  let current = client;
  for (const key of path) {
    if (!current) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * Same as resolveNode, but throws with the exact path instead of returning
 * undefined. A missing node otherwise surfaces later as a bare
 * "Cannot read properties of undefined", far from the real cause.
 * @param client  any
 * @param path  string[]
 */
function resolveNodeOrThrow(client: any, path: string[]) {
  const node = resolveNode(client, path);
  if (!node) {
    throw new Error(
      `[createQueryClient] No route found at path "${pathKey(path)}". ` +
        `Check that the client was built from the matching router/route tree.`
    );
  }
  return node;
}

/**
 * Picks the first present handler function from `candidates` on `routeProxy`
 * (e.g. "query" or "plain" for a query hook). Throws listing what was
 * actually found, so a renamed/missing handler fails at the call site
 * instead of as a downstream "fn is not a function".
 * @param routeProxy  any
 * @param candidates  string[]
 * @param path  string[]
 */
function requireHandler(routeProxy: any, candidates: string[], path: string[]) {
  for (const name of candidates) {
    if (typeof routeProxy[name] === "function") return routeProxy[name];
  }
  throw new Error(
    `[createQueryClient] Route at "${pathKey(
      path
    )}" has none of: ${candidates.join(", ")}. Found keys: ${
      Object.keys(routeProxy).join(", ") || "(none)"
    }`
  );
}

// ─── Fast Type Infers (For Base Static Client Mapping) ────────────────────────

type IsOptional<T> = [undefined] extends [T]
  ? true
  : {} extends T
  ? true
  : false;
type InferInput<F> = F extends (input: infer I, ...args: any[]) => any
  ? I
  : never;
type InferOutput<F> = F extends (...args: any[]) => Promise<infer O>
  ? O
  : never;
type InferChunk<F> = F extends (
  ...args: any[]
) => Promise<AsyncGenerator<infer C, any, any>>
  ? C
  : never;

type QueryOpts<O> = Omit<UseQueryOptions<O, Error, O>, "queryKey" | "queryFn">;
type MutationOpts<O, I> = Omit<
  UseMutationOptions<O, Error, I, unknown>,
  "mutationFn"
>;

/** input/opts are MaybeRefOrGetter so callers can pass a ref, a getter, or a plain value. */
type StaticQueryHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      data?: MaybeRefOrGetter<InferInput<F> | null | undefined>,
      opts?: QueryOpts<InferOutput<F>>
    ) => UseQueryReturnType<InferOutput<F>, Error>
  : (
      data: MaybeRefOrGetter<InferInput<F>>,
      opts?: QueryOpts<InferOutput<F>>
    ) => UseQueryReturnType<InferOutput<F>, Error>;

type StaticMutationHook<F> = (
  opts?: MutationOpts<InferOutput<F>, InferInput<F>>
) => UseMutationReturnType<InferOutput<F>, Error, InferInput<F>, unknown>;

type StaticStreamHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      input?: MaybeRefOrGetter<InferInput<F> | null | undefined>,
      opts?: { enabled?: MaybeRefOrGetter<boolean> }
    ) => VQStreamState<InferChunk<F>>
  : (
      input: MaybeRefOrGetter<InferInput<F>>,
      opts?: { enabled?: MaybeRefOrGetter<boolean> }
    ) => VQStreamState<InferChunk<F>>;

// ─── Legacy Type Infers (For Dynamic _kind Router Mapping) ────────────────────

/**
 * Extracts the phantom `_input`/`_output`/`_chunk` field of a `_kind` node.
 * A node that omits the field entirely (e.g. an input-less upload) still
 * structurally matches the optional-property check, but `infer` then
 * resolves to `never` instead of `undefined` — the [I] extends [never]
 * wrap corrects that so "no field" behaves the same as "field is undefined".
 */
type InferLegacyInput<R> = R extends { _input?: infer I }
  ? [I] extends [never]
    ? undefined
    : I
  : undefined;
type InferLegacyOutput<R> = R extends { _output?: infer O }
  ? [O] extends [never]
    ? undefined
    : O
  : undefined;
type InferLegacyChunk<R> = R extends { _chunk?: infer C }
  ? [C] extends [never]
    ? undefined
    : C
  : undefined;
type LegacyInput<Kind, I> = Kind extends "upload"
  ? I extends undefined
    ? Record<string, any> | FormData
    : I | FormData
  : I;

type LegacyQueryHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      data?: MaybeRefOrGetter<
        LegacyInput<"query", InferLegacyInput<T>> | null | undefined
      >,
      opts?: QueryOpts<InferLegacyOutput<T>>
    ) => UseQueryReturnType<InferLegacyOutput<T>, Error>
  : (
      data: MaybeRefOrGetter<LegacyInput<"query", InferLegacyInput<T>>>,
      opts?: QueryOpts<InferLegacyOutput<T>>
    ) => UseQueryReturnType<InferLegacyOutput<T>, Error>;

/** Kind is read from T["_kind"] itself so "upload" nodes actually get the FormData allowance. */
type LegacyMutationHook<T> = (
  opts?: MutationOpts<
    InferLegacyOutput<T>,
    LegacyInput<T extends { _kind: infer K } ? K : never, InferLegacyInput<T>>
  >
) => UseMutationReturnType<
  InferLegacyOutput<T>,
  Error,
  LegacyInput<T extends { _kind: infer K } ? K : never, InferLegacyInput<T>>,
  unknown
>;

type LegacyStreamHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      input?: MaybeRefOrGetter<
        LegacyInput<"stream", InferLegacyInput<T>> | null | undefined
      >,
      opts?: { enabled?: MaybeRefOrGetter<boolean> }
    ) => VQStreamState<InferLegacyChunk<T>>
  : (
      input: MaybeRefOrGetter<LegacyInput<"stream", InferLegacyInput<T>>>,
      opts?: { enabled?: MaybeRefOrGetter<boolean> }
    ) => VQStreamState<InferLegacyChunk<T>>;

// ─── Mapped Tree ──────────────────────────────────────────────────────────────
// NOTE: this is the fallback path used when a client lacks the zResolved__
// brand (i.e. it was not generated by extractAppRoutesTypes). ROUTE_KINDS in
// extract-types.ts, its four emitXMethod functions, and the _kind branches
// below must be kept in sync by hand — adding a route kind means updating all of them.

type MapVQNode<T> = T extends { _kind: "query" | "plain" }
  ? { useQuery: LegacyQueryHook<T> }
  : T extends { _kind: "mutate" | "upload" }
  ? { useMutation: LegacyMutationHook<T> }
  : T extends { _kind: "stream" }
  ? { useStream: LegacyStreamHook<T> }
  : T extends { query: infer Q }
  ? { useQuery: StaticQueryHook<Q> }
  : T extends { mutate: infer M }
  ? { useMutation: StaticMutationHook<M> }
  : T extends { upload: infer U }
  ? { useMutation: StaticMutationHook<U> }
  : T extends { stream: infer S }
  ? { useStream: StaticStreamHook<S> }
  : T extends object
  ? { [K in keyof T]: MapVQNode<T[K]> }
  : never;

export type VueQueryTree<T> = T extends object
  ? { [K in keyof T]: MapVQNode<T[K]> }
  : never;

// ─── O(1) Short-Circuit Mapping ────────────────────────────────────────────

// If the Router has the zResolved__ brand, it is the static generated file, return directly.
// Otherwise, fallback to the deep mapped VueQueryTree.
export type ResolveVueQueryTree<T> = T extends { zResolved__: true }
  ? T
  : VueQueryTree<T>;

// ─── Runtime hook factories ───────────────────────────────────────────────────

/**
 * Builds a useQuery composable bound to a resolved client function.
 * queryKey is a computed getter so Vue Query re-derives and refetches
 * whenever the unwrapped `data` input changes.
 */
function makeQueryHook(fn: (...args: any[]) => any, key: string) {
  return function (data?: MaybeRefOrGetter<unknown>, opts?: QueryOpts<any>) {
    return useQuery({
      queryKey: computed(() => [key, toValue(data)]),
      queryFn: () => fn(toValue(data)),
      ...opts,
    });
  };
}

/**
 * Builds a useMutation composable bound to a resolved client function.
 * Input is supplied at call time via mutate(input), same as vue-query.
 */
function makeMutationHook(fn: (...args: any[]) => any) {
  return function (opts?: MutationOpts<any, any>) {
    return useMutation({
      mutationFn: (input: unknown) => fn(input),
      ...opts,
    });
  };
}

/**
 * Builds a useStream composable that consumes an async generator and
 * exposes its progress as reactive refs.
 *
 * Re-runs whenever `enabled` or `input` change (watched via toValue so
 * refs, getters, and plain values all work). Each run is tagged with a
 * monotonically increasing runId; chunks from a superseded run are
 * dropped so out-of-order responses can never corrupt state.
 */
function makeStreamHook(fn: (...args: any[]) => any) {
  return function (
    input?: MaybeRefOrGetter<unknown>,
    opts?: { enabled?: MaybeRefOrGetter<boolean> }
  ) {
    const chunks = ref<any[]>([]) as Ref<any[]>;
    const latest = ref<any>(undefined);
    const done = ref(false);
    const error = ref<Error | undefined>(undefined);

    let runId = 0;

    const stop = watch(
      () => [toValue(opts?.enabled) !== false, toValue(input)] as const,
      ([isEnabled, inputValue]) => {
        const thisRunId = ++runId;
        chunks.value = [];
        latest.value = undefined;
        done.value = false;
        error.value = undefined;
        if (!isEnabled) return;

        (async () => {
          try {
            const gen: AsyncGenerator<any, void, unknown> = await fn(
              inputValue
            );
            for await (const chunk of gen) {
              if (thisRunId !== runId) return;
              chunks.value = [...chunks.value, chunk];
              latest.value = chunk;
            }
            if (thisRunId === runId) done.value = true;
          } catch (err) {
            if (thisRunId === runId) error.value = err as Error;
          }
        })();
      },
      { immediate: true }
    );

    onScopeDispose(() => {
      runId++; // invalidates any in-flight run so it stops writing state
      stop();
    });

    return { chunks, latest, done, error };
  };
}

// ─── Proxy builder ────────────────────────────────────────────────────────────

function buildProxy(client: any, cache: ProxyCache, path: string[] = []): any {
  return new Proxy(
    {},
    {
      get(_, prop: string | symbol) {
        if (
          typeof prop === "symbol" ||
          prop === "then" ||
          prop === "zResolved__"
        )
          return undefined;
        const key = prop as string;
        const fullKey = pathKey([...path, key]);
        if (cache.has(fullKey)) return cache.get(fullKey);

        let result: unknown;

        if (key === "useQuery") {
          const routeProxy = resolveNodeOrThrow(client, path);
          const handler = requireHandler(routeProxy, ["query", "plain"], path);
          result = makeQueryHook(handler, pathKey(path));
        } else if (key === "useMutation") {
          const routeProxy = resolveNodeOrThrow(client, path);
          const handler = requireHandler(
            routeProxy,
            ["mutate", "upload"],
            path
          );
          result = makeMutationHook(handler);
        } else if (key === "useStream") {
          const routeProxy = resolveNodeOrThrow(client, path);
          const handler = requireHandler(routeProxy, ["stream"], path);
          result = makeStreamHook(handler);
        } else {
          result = buildProxy(client, cache, [...path, key]);
        }

        cache.set(fullKey, result);
        return result;
      },
    }
  );
}

// ─── createQueryClient ────────────────────────────────────────────────────────

/**
 * Wraps a ClientTree with Vue Query composables.
 * Create once at module level — the internal cache is shared across all calls.
 */
export function createQueryClient<Router>(
  client: any
): ResolveVueQueryTree<Router> {
  const cache: ProxyCache = new Map();
  return buildProxy(client, cache) as ResolveVueQueryTree<Router>;
}
export const createVueQueryClient = createQueryClient;

export { useQueryClient };
