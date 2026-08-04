import { createClient } from "tsdkarc-x/client";
// import { createSwrClient } from "tsdkarc-x/react/swr";
import type { AppRoutes } from "./main";
import axios from "xior";

const baseURL =
  typeof window === "undefined"
    ? `http://localhost:${process.env.PORT || 3001}/api/arcx`
    : `/api/arcx`;

export const api = createClient<AppRoutes>(baseURL);
// export const apiSwr = createSwrClient<AppRoutes>(api);
