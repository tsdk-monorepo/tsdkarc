import { useState, useEffect } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseQueryOptions,
  type UseMutationResult,
  type UseMutationOptions,
} from "@tanstack/react-query";

// ─── Stream state ─────────────────────────────────────────────────────────────

export type RQStreamState<C> = {
  chunks: C[];
  latest: C | undefined;
  done: boolean;
  error: Error | undefined;
};

// ─── Runtime proxy utils ──────────────────────────────────────────────────────

type ProxyCache = Map<string, any>;

/**
 * Single source of truth for path formatting. Reused for both the proxy's
 * internal memoization key and the React Query cache key, so path formatting
 * never has to be changed in two places.
 * @param path  string[]
 */
function pathKey(path: string[]) {
  return path.join("/");
}

/**
 * Walks `path` segment by segment on `client`.
 * @param client  any
 * @param path  string[]
 * @returns the resolved node, or undefined if any segment is missing.
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
type MutationOpts<O, I> = Omit<UseMutationOptions<O, Error, I>, "mutationFn">;

type StaticQueryHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      data?: InferInput<F> | null,
      opts?: QueryOpts<InferOutput<F>>
    ) => UseQueryResult<InferOutput<F>, Error>
  : (
      data: InferInput<F>,
      opts?: QueryOpts<InferOutput<F>>
    ) => UseQueryResult<InferOutput<F>, Error>;

type StaticMutationHook<F> = (
  opts?: MutationOpts<InferOutput<F>, InferInput<F>>
) => UseMutationResult<InferOutput<F>, Error, InferInput<F>>;

type StaticStreamHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      input?: InferInput<F> | null,
      opts?: { enabled?: boolean }
    ) => RQStreamState<InferChunk<F>>
  : (
      input: InferInput<F>,
      opts?: { enabled?: boolean }
    ) => RQStreamState<InferChunk<F>>;

// ─── Legacy Type Infers (For Dynamic _kind Router Mapping) ────────────────────
type InferLegacyInput<R> = R extends { _input?: infer I } ? I : never;
type InferLegacyOutput<R> = R extends { _output?: infer O } ? O : never;
type InferLegacyChunk<R> = R extends { _chunk?: infer C } ? C : never;
type LegacyInput<Kind, I> = Kind extends "upload"
  ? I extends undefined
    ? Record<string, any> | FormData
    : I | FormData
  : I;

type LegacyQueryHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      data?: LegacyInput<"query", InferLegacyInput<T>> | null,
      opts?: QueryOpts<InferLegacyOutput<T>>
    ) => UseQueryResult<InferLegacyOutput<T>, Error>
  : (
      data: LegacyInput<"query", InferLegacyInput<T>>,
      opts?: QueryOpts<InferLegacyOutput<T>>
    ) => UseQueryResult<InferLegacyOutput<T>, Error>;

type LegacyMutationHook<T> = (
  opts?: MutationOpts<
    InferLegacyOutput<T>,
    LegacyInput<"mutate", InferLegacyInput<T>>
  >
) => UseMutationResult<
  InferLegacyOutput<T>,
  Error,
  LegacyInput<"mutate", InferLegacyInput<T>>
>;

type LegacyStreamHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      input?: LegacyInput<"stream", InferLegacyInput<T>> | null,
      opts?: { enabled?: boolean }
    ) => RQStreamState<InferLegacyChunk<T>>
  : (
      input: LegacyInput<"stream", InferLegacyInput<T>>,
      opts?: { enabled?: boolean }
    ) => RQStreamState<InferLegacyChunk<T>>;

// ─── Mapped Tree ──────────────────────────────────────────────────────────────
// NOTE: this is the fallback path used when a client lacks the zResolved__
// brand (i.e. it was not generated by extractAppRoutesTypes). ROUTE_KINDS in
// extract-types.ts, its four emitXMethod functions, and the _kind branches
// below must be kept in sync by hand — adding a route kind means updating all of them.

type MapRQNode<T> = T extends { _kind: "query" | "plain" }
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
  ? { [K in keyof T]: MapRQNode<T[K]> }
  : never;

export type ReactQueryTree<T> = T extends object
  ? { [K in keyof T]: MapRQNode<T[K]> }
  : never;

// ─── O(1) Short-Circuit Mapping ────────────────────────────────────────────

// If the Router has the zResolved__ brand, it is the static generated file, return directly.
// Otherwise, fallback to the deep mapped ReactQueryTree.
export type ResolveReactQueryTree<T> = T extends { zResolved__: true }
  ? T
  : ReactQueryTree<T>;

// ─── Runtime hook factories ───────────────────────────────────────────────────

/** Builds a memoized useQuery-backed hook bound to a specific route's fetch function and cache key. */
function makeQueryHook(fn: (...args: any[]) => any, key: string) {
  return function (data?: unknown, opts?: QueryOpts<any>) {
    return useQuery({
      queryKey: [key, data],
      queryFn: () => fn(data),
      ...opts,
    });
  };
}

/** Builds a memoized useMutation-backed hook; the trigger call's argument is passed straight to `fn`. */
function makeMutationHook(fn: (...args: any[]) => any) {
  return function (opts?: MutationOpts<any, any>) {
    return useMutation({
      mutationFn: (input: unknown) => fn(input),
      ...opts,
    });
  };
}

/**
 * Builds a hook wrapping an async-generator streaming route.
 * Hook identity is memoized per full route path (see buildProxy's cache) —
 * component re-renders reuse the same hook function, only the returned state updates.
 *
 * NOTE: `chunks` accumulates every chunk received for the lifetime of the
 * stream with no cap. For very long-lived or high-frequency streams this can
 * grow unbounded; if that's a concern for a given route, prefer reading
 * `latest` and managing your own bounded buffer instead of `chunks`.
 */
function makeStreamHook(fn: (...args: any[]) => any) {
  return function (input?: unknown, opts?: { enabled?: boolean }) {
    const enabled = opts?.enabled !== false;

    /**
     * Stable string key for the effect dependency. `input` is often an inline
     * object literal at the call site, which is a new reference every render;
     * comparing by Object.is (React's default effect-dep comparison) would
     * rerun the effect — and restart the stream — every render regardless of
     * whether the value actually changed. Serializing to JSON gives
     * value-based comparison instead. `input` itself (not inputKey) is still
     * what's passed to `fn` inside the effect, since that always reads the
     * current render's value.
     */
    const inputKey = JSON.stringify(input ?? null);

    const [state, setState] = useState<RQStreamState<any>>({
      chunks: [],
      latest: undefined,
      done: false,
      error: undefined,
    });

    useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      setState({
        chunks: [],
        latest: undefined,
        done: false,
        error: undefined,
      });

      (async () => {
        try {
          const gen: AsyncGenerator<any, void, unknown> = await fn(input);
          for await (const chunk of gen) {
            if (cancelled) return;
            setState((prev) => ({
              ...prev,
              chunks: [...prev.chunks, chunk],
              latest: chunk,
            }));
          }
          if (!cancelled) setState((prev) => ({ ...prev, done: true }));
        } catch (error) {
          if (!cancelled)
            setState((prev) => ({ ...prev, error: error as Error }));
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- inputKey is the intentional stable proxy for `input`
    }, [enabled, inputKey]);

    return state;
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
 * Wraps a ClientTree with React Query hooks.
 * Create once at module level — the internal cache is shared across all calls.
 */
export function createQueryClient<Router>(
  client: any
): ResolveReactQueryTree<Router> {
  const cache: ProxyCache = new Map();
  return buildProxy(client, cache) as ResolveReactQueryTree<Router>;
}
export const createReactQueryClient = createQueryClient;

export { useQueryClient };
