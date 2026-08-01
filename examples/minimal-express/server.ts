// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { ExpressAdapter } from "tsdkarc-x/express";
import { extractOpenApi } from "tsdkarc-x/openapi"; // TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // TypeScript v7 is currently not supported.
import { apiReference } from "@scalar/express-api-reference";
import fs from "fs/promises";
import path from "path";

const appRouter = defineRouter({});

const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new ExpressAdapter();
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3013,
});

// Generate OpenAPI JSON
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
    url: `http://localhost:3013/api/openapi`,
  })
);

export type AppRoutes = RoutesOf<typeof app>;

// 生成静态类型文件
const { clientDts, swrDts, reactQueryDts, vueQueryDts } =
  await extractAppRoutesTypesFull(app.routes, {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  });

await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
  fs.writeFile("./client/api-vue-query.d.ts", vueQueryDts),
]);

await fetch("http://localhost:3013/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });
