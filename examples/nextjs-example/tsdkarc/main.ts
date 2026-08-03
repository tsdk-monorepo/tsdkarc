/* eslint-disable @typescript-eslint/no-empty-object-type */
// main.ts
import {
  defineMiddleware,
  defineRouter,
  launchApp,
  RoutesOf,
  RpcError,
} from "tsdkarc-x";
import { FetchAdapter } from "tsdkarc-x/fetch";
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";

export const transport = new FetchAdapter({
  log: true,
});
const createContext = (req: Request) => {
  const token = req.headers.get("Authorization");
  return { token };
};
export type RequestMeta = Awaited<ReturnType<typeof createContext>>;
const authMw = defineMiddleware<{}, RequestMeta>()(
  async ({ ctx, meta }, next) => {
    if (!meta.token)
      throw new RpcError("UNAUTHORIZED", "Missing Authorization header");
    return next({
      traceId: crypto.randomUUID(),
      user: { id: "user_1", mfaToken: "" },
    });
  }
);

// 1. Create router instance
const appRouter = defineRouter({
  middlewares: [],
  modules: [],
});

// 2. Define specific routes
const userRoutes = appRouter.init((r) => ({
  health: () => "OK",
  userInfo: r.use(authMw).query(() => "OK"),
}));
export const routes = { users: userRoutes }; // routesExportName

const app = await launchApp({
  basePath: "/api/arcx",
  transport,
  createContext,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

export type AppRoutes = RoutesOf<typeof app>;

//  Generate openapi JSON
export const openapi = extractOpenApi(
  app.routes,
  {
    info: { title: "Nextjs Example API", version: "0.0.5" },
  },
  { entryFile: "./tsdkarc/main.ts" }
);

// Generate static type of routes
/*
const result =
  await extractAppRoutesTypesFull(app.routes, {
    entryFile: "./tsdkarc/main.ts",
  });
fs.writeFile('./types/client.d.ts', result.clientDts, 'utf8');
fs.writeFile('./types/swr-client.d.ts', result.swrDts, 'utf8');
fs.writeFile('./types/react-query-client.d.ts', result.reactQueryDts, 'utf8');
fs.writeFile('./types/vue-query-client.d.ts', result.vueQueryDts, 'utf8');
*/
