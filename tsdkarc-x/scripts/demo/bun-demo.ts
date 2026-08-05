import { defineRouter, launchApp, type RoutesOf } from "../../src"; // 'tsdkarc-x'
import { FetchAdapter, toFetchHandler } from "../../src/fetch-adapter"; // 'tsdkarc-x/fetch'

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define specific routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new FetchAdapter({ log: true });

// 3. Start server
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 0,
});

const fetchHandler = toFetchHandler(transport);
// @ts-ignore
const server = Bun.serve({
  port: 3002,
  // @ts-ignore
  fetch(req) {
    return fetchHandler(req);
  },
});

console.log(`Backend listening on http://localhost:${server.port}`);

// 4. Export route types for frontend
export type AppRoutes = RoutesOf<typeof app>;
