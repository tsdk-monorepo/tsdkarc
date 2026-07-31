// websocket-adapter.ts
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { ZodError } from "zod";
import { HttpResponse, RpcError } from "./types";
import type {
  TransportAdapter,
  RuntimeRouteTree,
  CreateContextFn,
  AnyRoute,
} from "./types";

interface WsRequest {
  id: string | number;
  path: string;
  input?: any;
}

function flattenTree(
  tree: RuntimeRouteTree,
  prefix = ""
): Record<string, AnyRoute> {
  const routes: Record<string, AnyRoute> = {};
  for (const [key, node] of Object.entries(tree)) {
    const currentPath = prefix ? `${prefix}/${key}` : key;
    if ("_kind" in node) routes[currentPath] = node as AnyRoute;
    else
      Object.assign(routes, flattenTree(node as RuntimeRouteTree, currentPath));
  }
  return routes;
}

export interface WsContext {
  ws: WebSocket;
  req: IncomingMessage;
}

export class WebSocketAdapter implements TransportAdapter<WsContext> {
  public readonly name = "websocket-adapter";
  public readonly wss: WebSocketServer;
  private httpServer: Server | null = null;

  private log = false;

  constructor(props?: { log?: boolean }) {
    this.log = props?.log || false;
    this.wss = new WebSocketServer({ noServer: true });
  }

  mount(
    basePath: string,
    routeTree: RuntimeRouteTree,
    createContext: CreateContextFn<WsContext, any>
  ): void {
    const routeMap = flattenTree(routeTree);

    this.wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
      const baseCtx = await createContext({ ws, req }).catch((err: any) => {
        ws.send(
          JSON.stringify({
            error: "INTERNAL_SERVER_ERROR",
            message: err.message,
          })
        );
        ws.close();
        return null;
      });
      if (!baseCtx) return;

      ws.on("message", async (msg: string) => {
        let parsed: WsRequest;
        try {
          parsed = JSON.parse(msg.toString());
        } catch {
          return ws.send(
            JSON.stringify({ error: "BAD_REQUEST", message: "Invalid JSON" })
          );
        }

        const { id, path, input } = parsed;
        if (!id || !path) {
          return ws.send(
            JSON.stringify({
              error: "BAD_REQUEST",
              message: "Missing id or path",
            })
          );
        }

        const route = routeMap[path];
        if (!route) {
          return ws.send(
            JSON.stringify({
              id,
              error: "NOT_FOUND",
              message: `Route ${path} not found`,
            })
          );
        }

        try {
          const waitUntil = (p: Promise<unknown>) => {
            p.catch(console.error);
          };

          const result = await route.handler(input, {
            meta: baseCtx,
            waitUntil,
          } as any);

          if (result instanceof HttpResponse) {
            return ws.send(JSON.stringify({ id, data: result.body }));
          }

          if (route._kind === "stream") {
            const generator = result as AsyncGenerator;
            for await (const chunk of generator) {
              ws.send(JSON.stringify({ id, chunk }));
            }
            return ws.send(JSON.stringify({ id, done: true }));
          }

          ws.send(JSON.stringify({ id, data: result }));
        } catch (error: any) {
          let rpcError: RpcError;
          if (error instanceof ZodError) {
            rpcError = new RpcError(
              "BAD_REQUEST",
              "Validation failed",
              error.issues.map((i) => ({
                path: i.path as any,
                message: i.message,
              }))
            );
          } else if (error instanceof RpcError) {
            rpcError = error;
          } else {
            console.error(`[WebSocketAdapter] System Error at ${path}:`, error);
            rpcError = new RpcError(
              "INTERNAL_SERVER_ERROR",
              error.message || "Internal Error"
            );
          }
          ws.send(
            JSON.stringify({
              id,
              error: rpcError.code,
              message: rpcError.message,
              issues: rpcError.issues,
            })
          );
        }
      });
    });

    if (this.log)
      console.log(
        `[WebSocket] Mapped ${Object.keys(routeMap).length} RPC routes.`
      );
  }

  start(port: number | string): Promise<void> {
    return new Promise((resolve) => {
      import("http").then(({ createServer }) => {
        this.httpServer = createServer();
        this.httpServer.on("upgrade", (request, socket, head) => {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit("connection", ws, request);
          });
        });

        this.httpServer.listen(port, () => {
          console.log(`🚀 WebSocket Server ready on ws://localhost:${port}`);
          resolve();
        });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.clients.forEach((client) => client.close());
      this.wss.close((err) => {
        if (err) return reject(err);
        if (this.httpServer) {
          this.httpServer.close((e) => (e ? reject(e) : resolve()));
        } else {
          resolve();
        }
      });
    });
  }
}
