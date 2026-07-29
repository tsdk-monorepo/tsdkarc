import { createClient, isRpcError } from "../../src/client";
import type { AppRoutes } from "./demo";
import type { AppRoutes as AppRoutes2 } from "./app-routes";
import type { AppRoutesSwr } from "./app-routes-swr";

import { createSwrClient } from "../../src/react/swr";
// 1. 初始化强类型客户端，并配置全局请求头（满足后端的 authMw 鉴权）
const config = {
  baseURL: "http://localhost:3000/api",
  getHeaders: () => ({
    Authorization: "Bearer my-super-secret-token",
  }),
};

const client = createClient<AppRoutes>(config);
const client2 = createClient<AppRoutes2>(config);

client2.v1.users.downloadLogs.stream;
client.v1.users.getProfile.query;
client2.v1.users.getProfile.query;

const swrHooks = createSwrClient<AppRoutes>(client);

const swrHooks2 = createSwrClient<AppRoutesSwr>(client);

swrHooks2.mock.aiRoutes1.complete;
swrHooks.v1.users;
swrHooks2.v1.users;

// swrHooks.v1.users.getProfile.useQuery();

async function run() {
  console.log("🚀 Starting E2E Client Tests...\n");

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // A. 基础路由与嵌套命名空间 (Plain & Nested)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("1️⃣  Testing Health Check (Plain Route)...");
    const health = await client.v1.users.health.query();
    console.log("   ✅ Health:", health);

    console.log("\n2️⃣  Testing Nested Settings (Namespaces)...");
    const theme = await client.v1.users.settings.getTheme.query();
    console.log("   ✅ Current Theme:", theme);

    const updatedTheme = await client.v1.users.settings.updateTheme.mutate({
      theme: "light_mode",
    });
    console.log("   ✅ Update Theme:", updatedTheme);

    // ─────────────────────────────────────────────────────────────────────────────
    // B. 数据查询与注入 (Query & DI)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n3️⃣  Testing Profile Query (With Schema & DI)...");
    const profile = await client.v1.users.getProfile.query({
      includeHistory: true,
    });
    // 完美类型推导：profile.id, profile.name, profile.history
    console.log("   ✅ Profile:", profile.name, "Role:", profile.role);

    // ─────────────────────────────────────────────────────────────────────────────
    // C. 复杂表单与文件上传 (Multipart / File)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n4️⃣  Testing File Upload (Coercion & FormData)...");
    // 注意：在 Node.js 20+ 中原生支持 File。如果是纯前端环境，直接用 input 选中的 File 对象
    const dummyFile = new File(["Hello World Image Content"], "avatar.png", {
      type: "image/png",
    });
    const uploadRes = await client.v1.users.uploadAvatar.upload({
      file: dummyFile,
      cropSize: 250, // 后端用 z.coerce.number() 完美将表单 string 转回 number
    });
    console.log("   ✅ Upload Success:", uploadRes);

    // ─────────────────────────────────────────────────────────────────────────────
    // D. 流式响应 (SSE / AsyncGenerator)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n5️⃣  Testing Server-Sent Events (SSE Streaming)...");
    const stream = await client.v1.users.downloadLogs.stream({ lines: 3 });
    // 完美的流式迭代体验
    for await (const chunk of stream) {
      console.log(`   🌊 [Stream Chunk ${chunk.index}]:`, chunk.text);
    }
    console.log("   ✅ Stream Complete!");

    // ─────────────────────────────────────────────────────────────────────────────
    // E. 幽灵任务 (Serverless waitUntil)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n6️⃣  Testing Background Task (waitUntil)...");
    const deviceRes = await client.v1.users.registerDevice.mutate({
      deviceId: "macbook-pro-m3",
    });
    console.log("   ✅ HTTP Resolved instantly:", deviceRes.success);
    console.log("   ⏳ (Check your backend console in 1s for the email log!)");

    // ─────────────────────────────────────────────────────────────────────────────
    // F. 强类型错误处理 (Type-Safe Error Boundary)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n7️⃣  Testing Error Handling...");
    await client.v1.users.triggerError.query();
  } catch (err) {
    // 🌟 核心：使用 isRpcError 进行完美的类型收窄
    if (isRpcError(err)) {
      console.log(
        `   ❌ [Caught RPC Error] Code: ${err.code}, Message: ${err.message}`
      );

      if (err.code === "BAD_REQUEST" && err.issues) {
        console.log("   📝 Validation Issues:", err.issues);
      }
    } else {
      console.error("   💥 [Unknown Error]:", err);
    }
  }

  // 测试 Zod 校验失败的自动拦截
  try {
    console.log("\n8️⃣  Testing Zod Validation Error...");
    // 故意传入低于限制的值 (min: 8)
    await client.v1.users.updatePassword.mutate({ newPwd: "123" });
  } catch (err) {
    if (isRpcError(err)) {
      console.log(`   ❌ [Zod Blocked] ${err.code}:`, err.issues);
    }
  }
  console.log("\n🎉 All tests executed!");

  {
    client.mock.aiRoutes4.complete;
    client2.mock.aiRoutes1.usageStats;
    client.mock.aiRoutes3;
    client2.v1.users.health.query(undefined);
    client.v1.users.health.query();
    client2.mock.aiRoutes1.chat.stream;
    client2.mock.aiRoutes2.complete.mutate;
    client2.mock.aiRoutes2.complete;
    client2.a.health.query();
    client2.mock.aiRoutes4.complete;
    client2.mock.aiRoutes2.moderateContent.mutate;
    client.mock.aiRoutes0.chat;
    client2.mock.aiRoutes1;
    client2.zResolved__;
  }
}

run();
