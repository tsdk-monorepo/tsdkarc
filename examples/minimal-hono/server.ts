// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { HonoAdapter } from "tsdkarc-x/hono";
import { extractOpenApi } from "tsdkarc-x/openapi"; // TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // TypeScript v7 is currently not supported.
import { Scalar } from "@scalar/hono-api-reference";
import fs from "fs/promises";
import path from "path";

const appRouter = defineRouter({});

const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName

const transport = new HonoAdapter();
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3015,
});

// Generate OpenAPI JSON
const openapiResult = extractOpenApi(
  app.routes,
  {
    info: { title: "API", version: "1.0.0" },
  },
  { entryFile: path.resolve("./server.ts") }
);
transport.app.get(`/api/openapi`, async (res) => {
  res.json(openapiResult);
});
transport.app.use(
  "/reference",
  Scalar({
    // Put your OpenAPI url here:
    url: `http://localhost:3015/api/openapi`,
  })
);

// 4. 导出路由类型供前端使用
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

await fetch("http://localhost:3015/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });
