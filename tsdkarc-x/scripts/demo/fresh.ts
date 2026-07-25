// server.ts
import { DeepFlat, defineMiddleware, defineRouter } from "../../src";
import { launchApp } from "../../src";
import { ExpressAdapter } from "../../src/express-adapter";
import { Request } from "express";
import { z } from "zod/v4";

import { type RoutesOf } from "../../src";
import { createClient, RpcError } from "../../src/client";

import { ContextOf, defineModule } from "tsdkarc";

export const dbModule = defineModule({ name: "db" }).init(() => ({
  findUser: (id: string) => ({ id, name: "Alice", role: "admin" }),
}));

export const createContext = async (c: Request) => ({
  get token() {
    return c.header("Authorization") || null;
  },
});

export type BaseCtx = DeepFlat<
  Awaited<ReturnType<typeof createContext>> & ContextOf<typeof dbModule>
>;

export const authMw = defineMiddleware<BaseCtx>()(async (ctx, next) => {
  // 这里校验 ctx.token，拿到用户信息
  return next({ user: { id: "u_1", role: "admin" } });
});

export const verifyMfaMw = defineMiddleware<{ user: { id: string } }>()(
  async (ctx, next) => {
    return next({ mfaPassed: true });
  }
);

export const loggerMw = defineMiddleware<{ ip: string | null }>()(
  async (ctx, next) => {
    console.log(`[Access Log] IP: ${ctx.ip}`);
    return next({ traceId: `req_${Date.now()}` });
  }
);

const appRouter = defineRouter({
  modules: [dbModule], // 声明依赖
  middlewares: [authMw, loggerMw],
}); // 先不接模块、不接中间件

const userRoutes = appRouter.init((r) => ({
  health: () => "OK", // 最简单的 handler：一个同步函数
  ping: r.query(async (_, env) => ({
    message: "pong",
    trace: env.meta.traceId,
    user: env.meta.user.id,
  })),
  getProfile: r.query(
    z.object({ includeHistory: z.boolean().default(false) }),
    async (input, env) => {
      const user = env.ctx.db.findUser("u_1"); // ✅ 类型自动来自 dbModule
      return { ...user, history: input.includeHistory ? [] : null };
    }
  ),
  updateTheme: r.mutate(
    z.object({ theme: z.enum(["dark_mode", "light_mode"]) }),
    (input) => `Theme changed to ${input.theme}`
  ),
  updatePassword: r
    .use(verifyMfaMw) // 只有这个路由会多经过一次 MFA 校验
    .mutate(z.object({ newPwd: z.string().min(8) }), async (input, env) => {
      if (!env.meta.mfaPassed) throw new RpcError("FORBIDDEN", "MFA Failed");
      return "Password updated securely";
    }),
}));

export const app = launchApp({
  basePath: "/api",
  transport: new ExpressAdapter(),
  createContext,
  routes: { users: userRoutes },
  port: 3011,
});

export type AppRoutes = RoutesOf<typeof app>;

// client

const client = createClient<AppRoutes>({
  baseURL: "http://localhost:3011/api",
});
async function run() {
  const health = await client.users.health.query(); // "OK"，且有类型提示
  console.log({ health });
  const profile = await client.users.getProfile.query({
    includeHistory: false,
  });
  console.log({ profile });
  const theme = await client.users.updateTheme.mutate({ theme: "dark_mode" });
  console.log({ theme });
}

run();
