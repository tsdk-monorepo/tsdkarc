import type { RouteEntry } from "./server";

/** Force TS to expand a type alias into its full shape in hover/intellisense. */
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

type CollectRoutes<T extends readonly any[]> = {
  [K in keyof T]: T[K] extends { routes: readonly (infer E)[] } ? E : never;
}[number];

type PathsFor<
  T extends readonly any[],
  Method extends string
> = CollectRoutes<T> extends infer E
  ? E extends RouteEntry<infer M, infer P, any, any>
    ? Uppercase<M> extends Method
      ? P
      : never
    : never
  : never;

type Find<
  T extends readonly any[],
  Method extends string,
  Path extends string
> = CollectRoutes<T> extends infer E
  ? E extends RouteEntry<infer M, infer P, any, any>
    ? Uppercase<M> extends Method
      ? P extends Path
        ? E
        : never
      : never
    : never
  : never;

type ReqOf<E> = E extends RouteEntry<any, any, infer R, any>
  ? Expand<R>
  : never;
type ResOf<E> = E extends RouteEntry<any, any, any, infer R>
  ? Expand<R>
  : never;

export function createClient<T extends readonly any[]>(baseUrl: string) {
  async function call<Req, Res>(
    method: string,
    path: string,
    data?: Req
  ): Promise<Res> {
    const isRead = method === "GET" || method === "HEAD";
    const url = isRead
      ? `${baseUrl}${path}?${new URLSearchParams(
          (data ?? {}) as Record<string, string>
        )}`
      : `${baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: isRead ? {} : { "Content-Type": "application/json" },
      body: isRead ? undefined : JSON.stringify(data),
    });

    if (!res.ok)
      throw new Error(`[client] ${method} ${path} → HTTP ${res.status}`);
    return res.json() as Promise<Res>;
  }

  return {
    get<Path extends PathsFor<T, "GET">>(
      path: Path,
      data?: ReqOf<Find<T, "GET", Path>>
    ) {
      return call<ReqOf<Find<T, "GET", Path>>, ResOf<Find<T, "GET", Path>>>(
        "GET",
        path,
        data
      );
    },
    post<Path extends PathsFor<T, "POST">>(
      path: Path,
      data?: ReqOf<Find<T, "POST", Path>>
    ) {
      return call<ReqOf<Find<T, "POST", Path>>, ResOf<Find<T, "POST", Path>>>(
        "POST",
        path,
        data
      );
    },
    delete<Path extends PathsFor<T, "DELETE">>(
      path: Path,
      data?: ReqOf<Find<T, "DELETE", Path>>
    ) {
      return call<
        ReqOf<Find<T, "DELETE", Path>>,
        ResOf<Find<T, "DELETE", Path>>
      >("DELETE", path, data);
    },
  };
}

// Usage:
// const api = createClient<AppModules>("http://localhost:5001");
