// ─── swr.ts ───────────────────────────────────────────────────────────────────
import useSWR, { type SWRResponse, type SWRConfiguration } from "swr";
import useSWRMutation, {
  type SWRMutationResponse,
  type SWRMutationConfiguration,
} from "swr/mutation";
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
  ? (opts?: SWRConfiguration<Expand<R>>) => SWRResponse<Expand<R>>
  : [] extends Args
  ? (
      data?: Expand<NonNullable<Args[0]>>,
      opts?: SWRConfiguration<Expand<R>>
    ) => SWRResponse<Expand<R>>
  : (
      data: Expand<Args[0]>,
      opts?: SWRConfiguration<Expand<R>>
    ) => SWRResponse<Expand<R>>;

type MutationHookFn<Args extends any[], R> = Args extends []
  ? (
      opts?: SWRMutationConfiguration<Expand<R>, Error, string, void>
    ) => SWRMutationResponse<Expand<R>, Error, string, void>
  : [] extends Args
  ? (
      opts?: SWRMutationConfiguration<
        Expand<R>,
        Error,
        string,
        Expand<NonNullable<Args[0]>> | void
      >
    ) => SWRMutationResponse<
      Expand<R>,
      Error,
      string,
      Expand<NonNullable<Args[0]>> | void
    >
  : (
      opts?: SWRMutationConfiguration<Expand<R>, Error, string, Expand<Args[0]>>
    ) => SWRMutationResponse<Expand<R>, Error, string, Expand<Args[0]>>;

// 2. We extract the full arguments tuple (infer Args) instead of mapping Parameters<F>
type SWRQueryHook<F> = F extends (...args: infer Args) => any
  ? QueryHookFn<Args, Awaited<ReturnType<F>>>
  : never;

type SWRMutationHook<F> = F extends (...args: infer Args) => any
  ? MutationHookFn<Args, Awaited<ReturnType<F>>>
  : never;

// ─── Tree Mapped Types ────────────────────────────────────────────────────────

type MapSWRHooksTree<T> = {
  [K in keyof T as K extends string ? K : never]: T[K] extends (
    ...args: any[]
  ) => any
    ? KindOf<T[K]> extends "query"
      ? { useQuery: SWRQueryHook<T[K]> }
      : KindOf<T[K]> extends "mutation"
      ? { useMutation: SWRMutationHook<T[K]> }
      : KindOf<T[K]> extends "stream"
      ? { useStream: StreamHookFn<T[K]> }
      : never
    : MapSWRHooksTree<T[K]>;
};

// ─── Runtime ──────────────────────────────────────────────────────────────────

function makeQueryHook(fn: (...args: any[]) => any, pathArray: string[]) {
  return function (data?: unknown, opts?: unknown) {
    return useSWR(
      [pathArray.join("/"), data],
      () => fn(data),
      opts as SWRConfiguration
    );
  };
}

function makeMutationHook(fn: (...args: any[]) => any, pathArray: string[]) {
  return function (opts?: unknown) {
    return useSWRMutation(
      pathArray.join("/"),
      (_key: string, { arg }: { arg: unknown }) => fn(arg),
      opts as SWRMutationConfiguration<any, any, any, any>
    );
  };
}

function createHookProxy(client: any, pathSegments: string[] = []): any {
  const cache = new Map<string | symbol, unknown>();
  return new Proxy(
    {},
    {
      get(_, prop: string) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (cache.has(prop)) return cache.get(prop);

        let result: unknown;

        if (prop === "useQuery") {
          // 👈 Walk the tree, then grab `.query` at the very end
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.query;
          if (typeof fetcher === "function")
            result = makeQueryHook(fetcher, pathSegments);
        } else if (prop === "useMutation") {
          // 👈 Walk the tree, then grab `.mutation` at the very end
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.mutation;
          if (typeof fetcher === "function")
            result = makeMutationHook(fetcher, pathSegments);
        } else if (prop === "useStream") {
          // 👈 Walk the tree, then grab `.stream` at the very end
          const fetcher = pathSegments.reduce(
            (acc, part) => acc?.[part],
            client
          )?.stream;
          if (typeof fetcher === "function") result = makeStreamHook(fetcher);
        } else {
          result = createHookProxy(client, [...pathSegments, prop]);
        }

        if (result !== undefined) cache.set(prop, result);
        return result;
      },
    }
  );
}

// ─── createSwrClient ──────────────────────────────────────────────────────────

export function createSwrClient<
  App extends Promise<{ ctx: object }> = Promise<{ ctx: object }>,
  Ctx = Awaited<App>["ctx"]
>(client: MapClientTree<Routes<Ctx>>): MapSWRHooksTree<Routes<Ctx>> {
  return createHookProxy(client);
}
