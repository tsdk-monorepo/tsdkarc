// main.ts
import { defineRouter, launchApp, RoutesOf } from "tsdkarc-x";
import { FetchAdapter } from "tsdkarc-x/fetch";
import { extractOpenApi } from "tsdkarc-x/openapi";
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract";

// 1. Create router instance
const appRouter = defineRouter({});

// 2. Define specific routes
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
export const routes = { users: userRoutes }; // routesExportName

export const transport = new FetchAdapter({
  log: true,
});

const app = await launchApp({
  basePath: "/api/arcx",
  transport,
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
  { entryFile: "./server/main.ts" }
);

// Generate static type of routes
/*
const result =
  await extractAppRoutesTypesFull(app.routes, {
    entryFile: "./server/main.ts",
  });
fs.writeFile('./types/client.d.ts', result.clientDts, 'utf8');
fs.writeFile('./types/swr-client.d.ts', result.swrDts, 'utf8');
fs.writeFile('./types/react-query-client.d.ts', result.reactQueryDts, 'utf8');
fs.writeFile('./types/vue-query-client.d.ts', result.vueQueryDts, 'utf8');
*/
