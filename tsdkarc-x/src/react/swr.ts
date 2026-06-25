import { useState, useEffect } from "react";
import useSWR, { type SWRResponse, type SWRConfiguration } from "swr";
import useSWRMutation, {
  type SWRMutationResponse,
  type SWRMutationConfiguration,
} from "swr/mutation";

// ─── Stream state ─────────────────────────────────────────────────────────────

export type SWRStreamState<C> = {
  data: C | undefined;
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

type StaticQueryHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      data?: InferInput<F> | null,
      opts?: SWRConfiguration<InferOutput<F>>
    ) => SWRResponse<InferOutput<F>>
  : (
      data: InferInput<F>,
      opts?: SWRConfiguration<InferOutput<F>>
    ) => SWRResponse<InferOutput<F>>;

type StaticMutationHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      opts?: SWRMutationConfiguration<
        InferOutput<F>,
        Error,
        string,
        InferInput<F> | void
      >
    ) => SWRMutationResponse<
      InferOutput<F>,
      Error,
      string,
      InferInput<F> | void
    >
  : (
      opts?: SWRMutationConfiguration<
        InferOutput<F>,
        Error,
        string,
        InferInput<F>
      >
    ) => SWRMutationResponse<InferOutput<F>, Error, string, InferInput<F>>;

type StaticStreamHook<F> = IsOptional<InferInput<F>> extends true
  ? (
      input?: InferInput<F> | null,
      opts?: { enabled?: boolean }
    ) => SWRStreamState<InferChunk<F>>
  : (
      input: InferInput<F>,
      opts?: { enabled?: boolean }
    ) => SWRStreamState<InferChunk<F>>;

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
      opts?: SWRConfiguration<InferLegacyOutput<T>>
    ) => SWRResponse<InferLegacyOutput<T>>
  : (
      data: LegacyInput<"query", InferLegacyInput<T>>,
      opts?: SWRConfiguration<InferLegacyOutput<T>>
    ) => SWRResponse<InferLegacyOutput<T>>;

type LegacyMutationHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      opts?: SWRMutationConfiguration<
        InferLegacyOutput<T>,
        Error,
        string,
        LegacyInput<"mutation", InferLegacyInput<T>> | void
      >
    ) => SWRMutationResponse<
      InferLegacyOutput<T>,
      Error,
      string,
      LegacyInput<"mutation", InferLegacyInput<T>> | void
    >
  : (
      opts?: SWRMutationConfiguration<
        InferLegacyOutput<T>,
        Error,
        string,
        LegacyInput<"mutation", InferLegacyInput<T>>
      >
    ) => SWRMutationResponse<
      InferLegacyOutput<T>,
      Error,
      string,
      LegacyInput<"mutation", InferLegacyInput<T>>
    >;

type LegacyStreamHook<T> = IsOptional<InferLegacyInput<T>> extends true
  ? (
      input?: LegacyInput<"stream", InferLegacyInput<T>> | null,
      opts?: { enabled?: boolean }
    ) => SWRStreamState<InferLegacyChunk<T>>
  : (
      input: LegacyInput<"stream", InferLegacyInput<T>>,
      opts?: { enabled?: boolean }
    ) => SWRStreamState<InferLegacyChunk<T>>;

// ─── Mapped Tree ──────────────────────────────────────────────────────────────

type MapSWRNode<T> = T extends { _kind: "query" | "plain" }
  ? { useQuery: LegacyQueryHook<T> }
  : T extends { _kind: "mutation" | "upload" }
  ? { useMutation: LegacyMutationHook<T> }
  : T extends { _kind: "stream" }
  ? { useStream: LegacyStreamHook<T> }
  : T extends { query: infer Q }
  ? { useQuery: StaticQueryHook<Q> }
  : T extends { mutation: infer M }
  ? { useMutation: StaticMutationHook<M> }
  : T extends { upload: infer U }
  ? { useMutation: StaticMutationHook<U> }
  : T extends { stream: infer S }
  ? { useStream: StaticStreamHook<S> }
  : T extends object
  ? { [K in keyof T]: MapSWRNode<T[K]> }
  : never;

export type SwrTree<T> = T extends object
  ? { [K in keyof T]: MapSWRNode<T[K]> }
  : never;

// ─── 🔥 O(1) Short-Circuit Mapping ─────────────────────────────────────────

// If the Router has the zResolved__ brand, it is the static generated file, return directly.
// Otherwise, fallback to the deep mapped SwrTree.
export type ResolveSwrTree<T> = T extends { zResolved__: true }
  ? T
  : SwrTree<T>;

// ─── Runtime hook factories ───────────────────────────────────────────────────

function makeQueryHook(fn: (...args: any[]) => any, pathKey: string) {
  return function (data?: unknown, opts?: SWRConfiguration) {
    return useSWR([pathKey, data], () => fn(data), opts);
  };
}

function makeMutationHook(fn: (...args: any[]) => any, pathKey: string) {
  return function (opts?: SWRMutationConfiguration<any, any, any, any>) {
    return useSWRMutation(
      pathKey,
      (_key: string, { arg }: { arg: unknown }) => fn(arg),
      opts
    );
  };
}

function makeStreamHook(fn: (...args: any[]) => any) {
  return function (input?: unknown, opts?: { enabled?: boolean }) {
    const enabled = opts?.enabled !== false;
    const [state, setState] = useState<SWRStreamState<any>>({
      data: undefined,
      done: false,
      error: undefined,
    });

    useEffect(() => {
      if (!enabled) return;
      let cancelled = false;
      setState({ data: undefined, done: false, error: undefined });

      (async () => {
        try {
          const gen: AsyncGenerator<any, void, unknown> = await fn(input);
          for await (const chunk of gen) {
            if (cancelled) return;
            setState((prev) => ({ ...prev, data: chunk }));
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
          result = makeMutationHook(
            routeProxy.mutation ?? routeProxy.upload,
            path.join("/")
          );
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

// ─── createSwrClient ──────────────────────────────────────────────────────────

/**
 * Wraps a ClientTree with SWR hooks.
 * Create once at module level — the internal cache is shared across all calls.
 */
export function createSwrClient<Router>(client: any): ResolveSwrTree<Router> {
  const cache: ProxyCache = new Map();
  return buildProxy(client, cache) as ResolveSwrTree<Router>;
}
