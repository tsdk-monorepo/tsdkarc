// src/lib/route.ts
// Shared Route type for all feature modules.

import { type Handler } from "hono";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface Route {
  method: HttpMethod;
  path: string;
  handler: Handler;
}