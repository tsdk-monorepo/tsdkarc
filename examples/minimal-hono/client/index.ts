import { createClient } from "tsdkarc-x/client";
import { createSwrClient } from "tsdkarc-x/react/swr";
import { createQueryClient as createReactQueryClient } from "tsdkarc-x/react/query";
// import { createQueryClient as createVueQueryClient } from "tsdkarc-x/vue/query";

import type { AppRoutes } from "../server";
const client = createClient<AppRoutes>({
  baseURL: "http://localhost:3015/api",
});

const health = await client.users.health.query();
console.log(health); // "OK"，并且享有完整的自动补全和类型提示

const swrHooks = createSwrClient<AppRoutes>(client); // react swr hooks
// swrHooks.users.health.useQuery()
const reactQueryHooks = createReactQueryClient<AppRoutes>(client); // react tanstack query hooks
// reactQueryHooks.users.health.useQuery()
// const vueQueryHooks = createVueQueryClient<AppRoutes>(client); // vue tanstack query hooks
// vueQueryHooks.users.health.useQuery()
