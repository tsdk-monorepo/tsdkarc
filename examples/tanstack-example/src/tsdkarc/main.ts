// main.ts
import {
  defineMiddleware,
  defineRouter,
  launchApp,
  RoutesOf,
  RpcError,
} from "tsdkarc-x";
import { FetchAdapter } from "tsdkarc-x/fetch";

export const transport = new FetchAdapter({
  log: true,
});
const createContext = (req: Request) => {
  const token = req.headers.get("Authorization");
  return { token };
};
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;
const authMw = defineMiddleware<{}, RequestMeta>()(async (
  { ctx, meta },
  next
) => {
  if (!meta.token)
    throw new RpcError("UNAUTHORIZED", "Missing Authorization header");
  return next({
    traceId: crypto.randomUUID(),
    user: { id: "user_1", mfaToken: "" },
  });
});

// 1. Create router instance
const appRouter = defineRouter();

// 2. Define specific routes
const userRoutes = appRouter.init((r) => ({
  health: () => "OK",
  userInfo: r.use(authMw).query(() => "OK"),
}));
export const routes = { users: userRoutes }; // routesExportName

export const app = await launchApp({
  basePath: "/api/arcx",
  transport,
  createContext,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;
