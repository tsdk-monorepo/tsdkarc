// server.ts
import { defineRouter, launchApp, type RoutesOf } from "tsdkarc-x";
import { HonoAdapter } from "tsdkarc-x/hono";
import { extractOpenApi } from "tsdkarc-x/openapi"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { extractAppRoutesTypesFull } from "tsdkarc-x/extract"; // Requires TypeScript v6. TypeScript v7 is currently not supported.
import { Scalar } from "@scalar/hono-api-reference";
import fs from "fs/promises";
import path from "path";

// 1. 创建路由实例
const appRouter = defineRouter({});

// 2. 定义具体路由
const userRoutes = appRouter.init(() => ({
  health: () => "OK",
}));
const routes = { users: userRoutes }; // routesExportName
const transport = new HonoAdapter();
// 3. 启动服务
export const app = await launchApp({
  basePath: "/api",
  transport,
  routes,
  port: 3015,
});

// 生成 OpenAPI 配置
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
const { clientDts, swrDts, reactQueryDts } = await extractAppRoutesTypesFull(
  app.routes,
  {
    entryFile: path.resolve("./server.ts"),
    tsConfigFilePath: path.resolve("./tsconfig.json"),
    routesExportName: "routes",
    includeSourceLocation: false,
  }
);

await Promise.all([
  fs.writeFile("./client/api.d.ts", clientDts),
  fs.writeFile("./client/api-swr.d.ts", swrDts),
  fs.writeFile("./client/api-query.d.ts", reactQueryDts),
]);

await fetch("http://localhost:3015/api/users/health")
  .then((res) => res.json())
  .then((res) => {
    console.log(res); // Output: OK
  });
