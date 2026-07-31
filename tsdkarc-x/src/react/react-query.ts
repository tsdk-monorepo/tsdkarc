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

function resolveNode(client: any, path: string[]) {
  let current = client;
  for (const key of path) {
    if (!current) return undefined;
    current = current[key];
  }
  return current;
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

// ─── 🔥 O(1) Short-Circuit Mapping ─────────────────────────────────────────

// If the Router has the zResolved__ brand, it is the static generated file, return directly.
// Otherwise, fallback to the deep mapped ReactQueryTree.
export type ResolveReactQueryTree<T> = T extends { zResolved__: true }
  ? T
  : ReactQueryTree<T>;

// ─── Runtime hook factories ───────────────────────────────────────────────────

function makeQueryHook(fn: (...args: any[]) => any, pathKey: string) {
  return function (data?: unknown, opts?: QueryOpts<any>) {
    return useQuery({
      queryKey: [pathKey, data],
      queryFn: () => fn(data),
      ...opts,
    });
  };
}

function makeMutationHook(fn: (...args: any[]) => any) {
  return function (opts?: MutationOpts<any, any>) {
    return useMutation({
      mutationFn: (input: unknown) => fn(input),
      ...opts,
    });
  };
}

function makeStreamHook(fn: (...args: any[]) => any) {
  return function (input?: unknown, opts?: { enabled?: boolean }) {
    const enabled = opts?.enabled !== false;
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
    }, [enabled, input]);

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
        const fullKey = [...path, key].join(".");
        if (cache.has(fullKey)) return cache.get(fullKey);

        let result: unknown;

        if (key === "useQuery") {
          const routeProxy = resolveNode(client, path);
          result = makeQueryHook(
            routeProxy.query ?? routeProxy.plain,
            path.join("/")
          );
        } else if (key === "useMutation") {
          const routeProxy = resolveNode(client, path);
          result = makeMutationHook(routeProxy.mutate ?? routeProxy.upload);
        } else if (key === "useStream") {
          const routeProxy = resolveNode(client, path);
          result = makeStreamHook(routeProxy.stream);
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
