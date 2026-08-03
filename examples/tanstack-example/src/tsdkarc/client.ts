import { createClient } from "tsdkarc-x/client";
// import { createSwrClient } from "tsdkarc-x/react/swr";
import type { AppRoutes } from "./main";

export const api = createClient<AppRoutes>(
  typeof window === "undefined"
    ? `http://127.0.0.1:${process.env.PORT || 3000}/api/arcx`
    : `/api/arcx`
);
// export const apiSwr = createSwrClient<AppRoutes>(api);
