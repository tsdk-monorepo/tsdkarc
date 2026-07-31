// fetch-adapter.ts
import { ZodError } from "zod";
import { HttpResponse, RpcError } from "./types";
import type {
  TransportAdapter,
  RuntimeRouteTree,
  CreateContextFn,
  AnyRoute,
} from "./types";

/**
 * HTTP status codes that should be treated as redirects when a route
 * returns an HttpResponse.
 */
const REDIRECT_STATUSES = [301, 302, 307, 308];

/** Maps RpcError codes to HTTP status codes for error responses. */
const ERROR_STATUS_MAP: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

function flattenTree(
  tree: RuntimeRouteTree,
  prefix = ""
): { path: string; route: AnyRoute }[] {
  const routes: { path: string; route: AnyRoute }[] = [];
  for (const [key, node] of Object.entries(tree)) {
    const currentPath = `${prefix}/${key}`;
    if ("_kind" in node)
      routes.push({ path: currentPath, route: node as AnyRoute });
    else routes.push(...flattenTree(node as RuntimeRouteTree, currentPath));
  }
  return routes;
}

/**
 * Builds the HTTP method used to register a route based on its kind.
 * "query" and "plain" routes are GET, everything else is POST.
 * @param kind AnyRoute["_kind"]
 * @returns "GET" | "POST"
 */
function methodForKind(kind: AnyRoute["_kind"]) {
  return kind === "query" || kind === "plain" ? "GET" : "POST";
}

/**
 * Parses URL search params into a raw input object, mirroring the
 * express adapter's query parsing (best-effort JSON.parse per value).
 * @param searchParams URLSearchParams
 * @returns Record<string, unknown> | undefined
 */
function parseQuery(searchParams: URLSearchParams) {
  const parsed: Record<string, unknown> = {};
  for (const [k, v] of searchParams.entries()) {
    try {
      parsed[k] = JSON.parse(v);
    } catch {
      parsed[k] = v;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * Parses a multipart/form-data (or urlencoded) request body for "upload"
 * routes. Fetch API FormData already yields native File instances, so no
 * buffer-to-File conversion is needed (unlike multer in express-adapter).
 * @param req Request
 * @returns Record<string, unknown>
 */
async function parseUpload(req: Request) {
  const form = await req.formData();
  const body: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    body[key] = value;
  }
  return body;
}

/**
 * Parses a JSON request body. Empty bodies resolve to undefined instead
 * of throwing, matching express's `Object.keys(req.body).length > 0` check.
 * @param req Request
 * @returns unknown
 * @throws RpcError("BAD_REQUEST") on malformed JSON
 */
async function parseJsonBody(req: Request) {
  const text = await req.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new RpcError("BAD_REQUEST", "Malformed JSON body");
  }
}

/**
 * Serializes a value as a JSON Response.
 * @param body unknown
 * @param status number
 * @returns Response
 */
function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Converts a route's HttpResponse return value into a Fetch API Response,
 * handling redirect statuses the same way express-adapter does.
 * @param result HttpResponse<unknown>
 * @returns Response
 */
function httpResponseToFetchResponse(result: HttpResponse<unknown>) {
  const status = result.meta.status || 200;
  const headers = new Headers(result.meta.headers || {});

  if (REDIRECT_STATUSES.includes(status)) {
    /**
     * Intentionally not using Response.redirect(): it resolves its URL
     * argument as absolute and throws on relative paths under Node's
     * fetch implementation (undici). A 3xx status + Location header on a
     * plain Response is a valid redirect on its own, and this also keeps
     * any other headers (e.g. Set-Cookie) the route attached.
     */
    if (!headers.has("Location")) headers.set("Location", "/");
    return new Response(null, { status, headers });
  }

  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(result.body), { status, headers });
}

/**
 * Streams an async generator's chunks as Server-Sent Events over a
 * Fetch API ReadableStream.
 * @param generator AsyncGenerator
 * @returns Response
 */
function streamToSseResponse(generator: AsyncGenerator) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of generator) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ __done: true })}\n\n`)
        );
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ __error: err.message })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Maps a caught error (ZodError, RpcError, or unknown) to a JSON error
 * Response, mirroring express-adapter's catch block.
 * @param error unknown
 * @param path string, used only for structured logging
 * @returns Response
 */
function errorToFetchResponse(error: any, path: string) {
  let rpcError: RpcError;

  if (error instanceof ZodError) {
    rpcError = new RpcError(
      "BAD_REQUEST",
      "Validation failed",
      error.issues.map((i) => ({ path: i.path as any, message: i.message }))
    );
  } else if (error instanceof RpcError) {
    rpcError = error;
  } else {
    console.error(`[FetchAdapter] System Error at ${path}:`, error);
    rpcError = new RpcError(
      "INTERNAL_SERVER_ERROR",
      error?.message || "Internal Error"
    );
  }

  return jsonResponse(
    {
      error: rpcError.code,
      message: rpcError.message,
      issues: rpcError.issues,
    },
    ERROR_STATUS_MAP[rpcError.code] || 500
  );
}

/**
 * TransportAdapter implementation on top of the Web Fetch API
 * (Request/Response). Unlike ExpressAdapter, there is no long-lived HTTP
 * server to bind: `mount` only builds an internal method+path route map,
 * and `handle` is the single entry point a serverless/edge runtime
 * (e.g. a Next.js App Router route.ts) calls per request.
 * start/stop are no-ops because the host runtime owns the listener.
 */
export class FetchAdapter implements TransportAdapter<Request> {
  public readonly name = "fetch-adapter";
  private routes = new Map<string, AnyRoute>();
  private createContext!: CreateContextFn<Request, any>;
  private log = false;

  constructor(props?: { log?: boolean }) {
    this.log = props?.log || false;
  }

  mount(
    basePath: string,
    routeTree: RuntimeRouteTree,
    createContext: CreateContextFn<Request, any>
  ) {
    this.createContext = createContext;
    const flatRoutes = flattenTree(routeTree, basePath);

    for (const { path, route } of flatRoutes) {
      const method = methodForKind(route._kind);
      this.routes.set(`${method}:${path}`, route);
      if (this.log) console.log(`[Fetch] Mapped: [${method}] ${path}`);
    }
  }

  /**
   * Handles a single Fetch API Request and resolves a Response. Wire this
   * into a Next.js App Router handler:
   *
   *   const adapter = new FetchAdapter();
   *   adapter.mount("/api/trpc", routeTree, createContext);
   *   export const { GET, POST } = toNextRouteHandlers(adapter);
   *
   * @param req Request
   * @param waitUntil Optional platform background-task hook (e.g. Vercel
   *   Edge Function `context.waitUntil`, or Next.js `unstable_after`).
   *   Defaults to fire-and-forget with console.error, which is only safe
   *   on long-lived servers — serverless/edge runtimes can freeze the
   *   function right after the response is sent, so pass the platform's
   *   real hook there instead of relying on the default.
   * @returns Promise<Response>
   */
  async handle(
    req: Request,
    waitUntil: (p: Promise<unknown>) => void = (p) => {
      p.catch(console.error);
    }
  ): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const route = this.routes.get(`${method}:${url.pathname}`);

    if (!route) {
      return jsonResponse(
        {
          error: "NOT_FOUND",
          message: `No route for ${method} ${url.pathname}`,
        },
        404
      );
    }

    try {
      const baseCtx = await this.createContext(req);
      let rawInput: unknown;

      if (route._kind === "query" || route._kind === "plain") {
        rawInput = parseQuery(url.searchParams);
      } else if (route._kind === "upload") {
        rawInput = await parseUpload(req);
      } else {
        rawInput = await parseJsonBody(req);
      }

      const result = await route.handler(rawInput, {
        meta: baseCtx,
        waitUntil,
      } as any);

      if (result instanceof HttpResponse) {
        return httpResponseToFetchResponse(result);
      }

      if (route._kind === "stream") {
        return streamToSseResponse(result as AsyncGenerator);
      }

      return jsonResponse(result, 200);
    } catch (error: any) {
      return errorToFetchResponse(error, url.pathname);
    }
  }

  start(): Promise<void> {
    /** No-op: the host runtime (Next.js/Vercel/edge) owns the HTTP listener. */
    return Promise.resolve();
  }

  stop(): Promise<void> {
    /** No-op: a Fetch handler holds no server resources to release. */
    return Promise.resolve();
  }
}

/**
 * Adapts a mounted FetchAdapter into Next.js App Router exports.
 * @param adapter FetchAdapter, already mounted via adapter.mount(...)
 * @param waitUntil Optional platform background-task hook, forwarded to
 *   every request. See FetchAdapter.handle for why this matters on
 *   serverless/edge runtimes.
 * @returns { GET, POST } route handler functions
 */
export function toNextRouteHandlers(
  adapter: FetchAdapter,
  waitUntil?: (p: Promise<unknown>) => void
) {
  const handler = (req: Request) => adapter.handle(req, waitUntil);
  return { GET: handler, POST: handler };
}
