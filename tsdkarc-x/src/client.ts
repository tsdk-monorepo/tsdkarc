// client.ts
import axios, { isAxiosError } from "xior";
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "xior";
import { RpcError } from "./utils";

export { RpcError, isRpcError } from "./utils";

const defaultAxiosInstance = axios.create();

export interface RequestOptions
  extends Omit<
    AxiosRequestConfig,
    "url" | "method" | "data" | "params" | "baseURL"
  > {}

export interface ClientConfig extends AxiosRequestConfig {
  getHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  axiosInstance?: AxiosInstance;
}

// ─── Legacy Type Mapping (Fallback for non-generated backend types) ─────────

type RouteKind = "query" | "mutate" | "stream" | "upload" | "plain";

type InferInput<R> = R extends { _input?: infer I } ? I : never;
type InferOutput<R> = R extends { _output?: infer O } ? O : never;
type InferStreamChunk<R> = R extends { _chunk?: infer C } ? C : never;

type IsOptional<T> = [undefined] extends [T]
  ? true
  : {} extends T
  ? true
  : false;

type ClientInput<Kind extends RouteKind, I> = Kind extends "upload"
  ? I extends undefined
    ? Record<string, any> | FormData
    : I | FormData
  : I;

type ClientReturn<Kind extends RouteKind, O> = Kind extends "stream"
  ? Promise<AsyncGenerator<O, void, unknown>>
  : Promise<O>;

type ClientFn<Kind extends RouteKind, I, O> = IsOptional<I> extends true
  ? (
      input?: ClientInput<Kind, I> | null,
      opts?: RequestOptions
    ) => ClientReturn<Kind, O>
  : (
      input: ClientInput<Kind, I>,
      opts?: RequestOptions
    ) => ClientReturn<Kind, O>;

type ExtractRoute<T, Kind> = Kind extends "query" | "plain"
  ? { query: ClientFn<"query", InferInput<T>, InferOutput<T>> }
  : Kind extends "mutate"
  ? { mutate: ClientFn<"mutate", InferInput<T>, InferOutput<T>> }
  : Kind extends "stream"
  ? { stream: ClientFn<"stream", InferInput<T>, InferStreamChunk<T>> }
  : Kind extends "upload"
  ? { upload: ClientFn<"upload", InferInput<T>, InferOutput<T>> }
  : never;

// Fallback deep mapper for dynamic router schemas
type MapNode<T> = T extends { _kind: infer Kind extends RouteKind }
  ? ExtractRoute<T, Kind>
  : T extends (...args: any[]) => any
  ? { query: ClientFn<"query", Parameters<T>[0], Awaited<ReturnType<T>>> }
  : T extends object
  ? { [K in keyof T]: MapNode<T[K]> }
  : never;

export type ClientTree<T> = T extends object
  ? { [K in keyof T]: MapNode<T[K]> }
  : never;

// ─── 🔥 O(1) Short-Circuit Mapping ─────────────────────────────────────────

// If the Router has the zResolved__ brand, return it directly. No mapping overhead.
// Otherwise, fallback to the deep mapped ClientTree.
export type ResolveClientRoot<T> = T extends { zResolved__: true }
  ? T
  : ClientTree<T>;

// ─── Runtime Implementation ────────────────────────────────────────────────────────

function hasFileOrBlob(value: unknown): boolean {
  if (value instanceof File || value instanceof Blob) return true;
  if (Array.isArray(value)) return value.some(hasFileOrBlob);
  if (value !== null && typeof value === "object")
    return Object.values(value).some(hasFileOrBlob);
  return false;
}

function toFormData(data: any): FormData {
  const fd = new FormData();
  if (data instanceof File || data instanceof Blob) {
    fd.append("file", data);
    return fd;
  }
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (value instanceof File) fd.append(key, value, value.name);
    else if (value instanceof Blob) fd.append(key, value);
    else if (value instanceof Date) fd.append(key, value.toISOString());
    else if (typeof value === "object") fd.append(key, JSON.stringify(value));
    else fd.append(key, String(value));
  }
  return fd;
}

async function* readSSE<O>(
  res: AxiosResponse
): AsyncGenerator<O, void, unknown> {
  const data = res.data;
  if (data && typeof data.getReader === "function") {
    const reader = data.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          if (!event.startsWith("data: ")) continue;
          const payload = JSON.parse(event.slice(6));
          if (payload.__done) return;
          if (payload.__error) throw new Error(payload.__error);
          yield payload as O;
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else if (data && typeof data[Symbol.asyncIterator] === "function") {
    let buffer = "";
    for await (const chunk of data as any) {
      buffer += chunk.toString();
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        if (!event.startsWith("data: ")) continue;
        const payload = JSON.parse(event.slice(6));
        if (payload.__done) return;
        if (payload.__error) throw new Error(payload.__error);
        yield payload as O;
      }
    }
  } else {
    throw new Error("[client] Axios response is not a stream.");
  }
}

async function executeRequest(
  baseURL: string,
  {
    axiosInstance,
    getHeaders,
    headers: _headers = {},
    ...restOpts
  }: ClientConfig,
  pathSegments: string[],
  kind: RouteKind,
  input: unknown,
  reqOpts: RequestOptions
): Promise<unknown> {
  const url = `${baseURL}/${pathSegments.join("/")}`;
  const dynamicHeaders = getHeaders ? await getHeaders() : {};
  const headers = { ..._headers, ...dynamicHeaders, ...reqOpts.headers };

  const axiosConfig: AxiosRequestConfig = {
    ...reqOpts,
    ...restOpts,
    url,
    headers,
    method: kind === "query" || kind === "plain" ? "GET" : "POST",
  };

  if ((kind === "query" || kind === "plain") && input) {
    axiosConfig.params = input;
  } else {
    const isMultipart = kind === "upload" || hasFileOrBlob(input);
    axiosConfig.data = isMultipart ? toFormData(input) : input;
  }

  if (kind === "stream") axiosConfig.responseType = "stream";

  const http = axiosInstance ?? defaultAxiosInstance;

  try {
    const res = await http.request(axiosConfig);
    if (kind === "stream") return readSSE(res);
    return res.data;
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      const data = error.response.data;
      if (typeof data === "object" && data !== null && "error" in data) {
        throw new RpcError(
          data.error,
          data.message || "Request failed",
          data.issues
        );
      }
    }
    throw error;
  }
}

export function createClient<Router>(
  url: string,
  config?: Omit<ClientConfig, "baseURL">
): ResolveClientRoot<Router>;
export function createClient<Router>(
  config: ClientConfig & { baseURL: string }
): ResolveClientRoot<Router>;
export function createClient<Router>(
  ...args: any[]
): ResolveClientRoot<Router> {
  const cfg: ClientConfig =
    typeof args[0] === "string" ? { baseURL: args[0], ...args[1] } : args[0];
  const baseURL = cfg.baseURL?.replace(/\/$/, "") ?? "";
  const PROXY_CACHE = new Map<string, any>();

  function buildProxy(pathSegments: string[] = []): unknown {
    const cacheKey = pathSegments.join(".");
    if (PROXY_CACHE.has(cacheKey)) return PROXY_CACHE.get(cacheKey);

    const proxy = new Proxy(function () {}, {
      get(_, prop: string | symbol) {
        if (
          typeof prop === "symbol" ||
          prop === "then" ||
          prop === "catch" ||
          prop === "finally" ||
          prop === "zResolved__" // Don't forward internal brand checks
        ) {
          return undefined;
        }
        return buildProxy([...pathSegments, prop]);
      },
      apply(_, __, [input, reqOpts]: [unknown, RequestOptions?]) {
        const segments = [...pathSegments];
        const kind = segments.pop() as RouteKind;
        return executeRequest(
          baseURL,
          cfg,
          segments,
          kind,
          input,
          reqOpts ?? {}
        );
      },
    });

    PROXY_CACHE.set(cacheKey, proxy);
    return proxy;
  }
  return buildProxy() as unknown as ResolveClientRoot<Router>;
}
