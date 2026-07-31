// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { FetchAdapter, toNextRouteHandlers } from "tsdkarc-x/fetch";
import { extractOpenApi } from "tsdkarc-x/openapi"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
// import { apiReference } from "@scalar/express-api-reference";
import fs from "fs/promises";
import path from "path";

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
  basePath: "/api/neat",
  transport,
  routes,
  port: 0, // unused — FetchAdapter.start() is a no-op, doesn't bind a port
});

/*
const transport = new FetchAdapter({ log: true });

// 3. Start server
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3000,
});

// Generate OpenAPI config
const openapiResult = extractOpenApi(
  app.routes,
  {
    info: { title: "API", version: "1.0.0" },
  },
  { entryFile: path.resolve("./server.ts") }
);
transport.app.get(`/api/openapi`, async (req, res) => {
  res.json(openapiResult);
});
transport.app.use(
  "/reference",
  apiReference({
    // Put your OpenAPI url here:
    url: `http://localhost:3000/api/openapi`,
  })
);

// 4. Export route types for frontend
export type AppRoutes = RoutesOf<typeof app>;

// Generate static type files
const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
  app.routes,
  {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  }
);
// Write static files
await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
]);

await fetch("http://localhost:3000/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });

  */
