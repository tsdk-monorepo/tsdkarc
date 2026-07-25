// ─── client.ts ────────────────────────────────────────────────────────────────

import { Expand, Routes, KindOf } from "./hook-utils";

// ─── Client fn types ──────────────────────────────────────────────────────────

/** Project a BrandedClientFn to its standard call signature. */
// ─── Client fn types ──────────────────────────────────────────────────────────

/** Project a BrandedClientFn to its standard call signature. */
type ClientFn<F> = F extends (...args: infer Args) => Promise<infer R>
  ? Args extends []
    ? () => Promise<Expand<R>> // 0 arguments
    : [] extends Args
    ? (data?: Expand<NonNullable<Args[0]>>) => Promise<Expand<R>> // 1 optional argument
    : (data: Expand<Args[0]>) => Promise<Expand<R>> // 1 required argument
  : never;

/** Project a BrandedClientFn to its Stream generator call signature. */
type YieldOf<F> = F extends (...args: any[]) => AsyncIterable<infer Y>
  ? Y
  : unknown;

type StreamFn<F> = F extends (...args: infer Args) => AsyncIterable<any>
  ? Args extends []
    ? () => AsyncGenerator<Expand<YieldOf<F>>>
    : [] extends Args
    ? (
        data?: Expand<NonNullable<Args[0]>>
      ) => AsyncGenerator<Expand<YieldOf<F>>>
    : (data: Expand<Args[0]>) => AsyncGenerator<Expand<YieldOf<F>>>
  : never;

// ─── Tree Mapped Types ────────────────────────────────────────────────────────

/** * Maps the entire route tree, replacing the leaf functions with
 * { query: ... }, { mutate: ... }, or { stream: ... }
 */
export type MapClientTree<T> = {
  [K in keyof T as K extends string ? K : never]: T[K] extends (
    ...args: any[]
  ) => any
    ? KindOf<T[K]> extends "query"
      ? { query: ClientFn<T[K]> }
      : KindOf<T[K]> extends "mutate"
      ? { mutate: ClientFn<T[K]> }
      : KindOf<T[K]> extends "stream"
      ? { stream: StreamFn<T[K]> }
      : never
    : MapClientTree<T[K]>; // Recurse into namespaces
};

// ─── Shared utilities ─────────────────────────────────────────────────────────

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function hasFileOrBlob(value: unknown): boolean {
  if (value instanceof File) return true;
  if (value instanceof Blob) return true;
  if (typeof FileList !== "undefined" && value instanceof FileList) return true;
  if (Array.isArray(value)) return value.some(hasFileOrBlob);
  if (value !== null && typeof value === "object") {
    return Object.values(value as object).some(hasFileOrBlob);
  }
  return false;
}

function toFormData(data: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    if (typeof FileList !== "undefined" && value instanceof FileList) {
      for (let i = 0; i < value.length; i++) fd.append(key, value[i]);
    } else if (value instanceof File) {
      fd.append(key, value, value.name);
    } else if (value instanceof Blob) {
      fd.append(key, value);
    } else if (typeof value === "object" || Array.isArray(value)) {
      fd.append(key, JSON.stringify(value));
    } else {
      fd.append(key, String(value));
    }
  }
  return fd;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchGet(url: string, data: unknown): Promise<unknown> {
  let fullUrl = url;
  if (data !== undefined && data !== null) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      params.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    const qs = params.toString();
    if (qs) fullUrl = `${url}?${qs}`;
  }
  const res = await fetch(fullUrl, { method: "GET" });
  if (!res.ok) throw new Error(`[client] GET ${fullUrl} → HTTP ${res.status}`);
  return res.json();
}

async function fetchPost(url: string, data: unknown): Promise<unknown> {
  const isMultipart =
    data !== null && typeof data === "object" && hasFileOrBlob(data);
  const body = isMultipart
    ? toFormData(data as Record<string, unknown>)
    : JSON.stringify(data !== undefined ? data : {});
  const headers = isMultipart ? {} : JSON_HEADERS;

  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`[client] POST ${url} → HTTP ${res.status}`);
  return res.json();
}

async function* fetchStream(
  url: string,
  data: unknown
): AsyncGenerator<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data ?? {}),
  });
  if (!res.ok) throw new Error(`[client] STREAM ${url} → HTTP ${res.status}`);
  if (!res.body) throw new Error(`[client] STREAM ${url} → no response body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.__done) return;
        if (payload.__error) {
          throw Object.assign(new Error(payload.__error), {
            status: payload.__status ?? 500,
          });
        }
        yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Proxy factory ────────────────────────────────────────────────────────────

function createPathProxy(baseUrl: string, pathSegments: string[] = []): any {
  const cache = new Map<string, unknown>();

  return new Proxy(
    {},
    {
      get(_, prop: string) {
        if (cache.has(prop)) return cache.get(prop);

        let result: unknown;

        // When we hit the leaf node, assemble the full URL and return the fetcher
        if (prop === "query") {
          const url = `${baseUrl}/${pathSegments.join("/")}`;
          result = (data?: unknown) => fetchGet(url, data);
        } else if (prop === "mutate") {
          const url = `${baseUrl}/${pathSegments.join("/")}`;
          result = (data?: unknown) => fetchPost(url, data);
        } else if (prop === "stream") {
          const url = `${baseUrl}/${pathSegments.join("/")}`;
          result = (data?: unknown) => fetchStream(url, data);
        } else {
          // Otherwise, keep walking down the tree
          result = createPathProxy(baseUrl, [...pathSegments, prop]);
        }

        cache.set(prop, result);
        return result;
      },
    }
  );
}

// ─── createClient ─────────────────────────────────────────────────────────────

/**
 * Creates a fully typed, chainable API client.
 * * @example
 * const api = createClient<App>("http://localhost:5001");
 * * const data = await api.users.get.query({ id: "1" });
 * const updated = await api.settings.update.mutate({ theme: "dark" });
 * * for await (const chunk of api.ai.chat.stream({ msg: "hi" })) {
 * console.log(chunk);
 * }
 */
export function createClient<
  App extends Promise<{ ctx: object }> = Promise<{ ctx: object }>,
  Ctx = Awaited<App>["ctx"]
>(baseUrl: string): MapClientTree<Routes<Ctx>> {
  return createPathProxy(baseUrl) as any;
}
