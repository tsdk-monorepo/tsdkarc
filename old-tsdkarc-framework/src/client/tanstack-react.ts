// ─── tanstack-react.ts ────────────────────────────────────────────────────────
import {
  useQuery,
  useMutation,
  type UseQueryResult,
  type UseMutationResult,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";
import type { MapClientTree } from "./"; // 👈 Use the unified tree type
import {
  type Expand,
  type Routes,
  type KindOf,
  type StreamHookFn, // Make sure this is exported from hook-utils
} from "./hook-utils";
import { makeStreamHook } from "./make-stream-hook";

// ─── Hook fn types ────────────────────────────────────────────────────────────

// 1. We pass the Args tuple directly into these helpers to strictly check for optionality
type QueryHookFn<Args extends any[], R> = Args extends []
  ? (
      opts?: Omit<UseQueryOptions<Expand<R>>, "queryKey" | "queryFn">
    ) => UseQueryResult<Expand<R>>
  : [] extends Args
  ? (
      data?: Expand<NonNullable<Args[0]>>,
      opts?: Omit<UseQueryOptions<Expand<R>>, "queryKey" | "queryFn">
    ) => UseQueryResult<Expand<R>>
  : (
      data: Expand<Args[0]>,
      opts?: Omit<UseQueryOptions<Expand<R>>, "queryKey" | "queryFn">
    ) => UseQueryResult<Expand<R>>;

type MutationHookFn<Args extends any[], R> = Args extends []
  ? (
      opts?: Omit<UseMutationOptions<Expand<R>, Error, void>, "mutationFn">
    ) => UseMutationResult<Expand<R>, Error, void>
  : [] extends Args
  ? (
      opts?: Omit<
        UseMutationOptions<
          Expand<R>,
          Error,
          Expand<NonNullable<Args[0]>> | void
        >,
        "mutationFn"
      >
    ) => UseMutationResult<
      Expand<R>,
      Error,
      Expand<NonNullable<Args[0]>> | void
    >
  : (
      opts?: Omit<
        UseMutationOptions<Expand<R>, Error, Expand<Args[0]>>,
        "mutationFn"
      >
    ) => UseMutationResult<Expand<R>, Error, Expand<Args[0]>>;

// 2. We extract the full arguments tuple (infer Args) instead of mapping Parameters<F>
type TanstackQueryHook<F> = F extends (...args: infer Args) => any
  ? QueryHookFn<Args, Awaited<ReturnType<F>>>
  : never;

type TanstackMutationHook<F> = F extends (...args: infer Args) => any
  ? MutationHookFn<Args, Awaited<ReturnType<F>>>
  : never;

// ─── Tree Mapped Types ────────────────────────────────────────────────────────

type MapHooksTree<T> = {
  [K in keyof T as K extends string ? K : never]: T[K] extends (
    ...args: any[]
  ) => any
    ? KindOf<T[K]> extends "query"
      ? { useQuery: TanstackQueryHook<T[K]> }
      : KindOf<T[K]> extends "mutation"
      ? { useMutation: TanstackMutationHook<T[K]> }
      : KindOf<T[K]> extends "stream"
      ? { useStream: StreamHookFn<T[K]> }
      : never
    : MapHooksTree<T[K]>;
};

// ─── Runtime ──────────────────────────────────────────────────────────────────

function makeQueryHook(fn: (...args: any[]) => any, pathArray: string[]) {
  return function (data?: unknown, opts?: unknown) {
    return useQuery({
      queryKey: [...pathArray, data],
      queryFn: () => fn(data),
      ...(opts as object),
    });
  };
}

function makeMutationHook(fn: (...args: any[]) => any, pathArray: string[]) {
  return function (opts?: unknown) {
    return useMutation({
      mutationKey: pathArray,
      mutationFn: (data: unknown) => fn(data),
      ...(opts as object),
    });
  };
}

function createHookProxy(client: any, pathSegments: string[] = []): any {
  const cache = new Map<string | symbol, unknown>();
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (cache.has(prop)) return cache.get(prop);

        let result: unknown;

        if (prop === "useQuery") {
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.query;
          if (typeof fetcher === "function")
            result = makeQueryHook(fetcher, pathSegments);
        } else if (prop === "useMutation") {
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.mutation;
          if (typeof fetcher === "function")
            result = makeMutationHook(fetcher, pathSegments);
        } else if (prop === "useStream") {
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.stream;
          if (typeof fetcher === "function") result = makeStreamHook(fetcher);
        } else {
          result = createHookProxy(client, [...pathSegments, prop as string]);
        }

        if (result !== undefined) cache.set(prop, result);
        return result;
      },
    }
  );
}

// ─── createTanstackClient ─────────────────────────────────────────────────────

export function createTanstackClient<
  App extends Promise<{ ctx: object }> = Promise<{ ctx: object }>,
  Ctx = Awaited<App>["ctx"]
>(client: MapClientTree<Routes<Ctx>>): MapHooksTree<Routes<Ctx>> {
  return createHookProxy(client);
}
