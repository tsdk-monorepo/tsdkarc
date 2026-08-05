import { createFileRoute } from "@tanstack/react-router";

import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "@/tsdkarc/main";

const handler = toFetchHandler(transport);

export const Route = createFileRoute("/api/arcx/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return handler(request);
      },
      POST: async ({ request }) => {
        return handler(request);
      },
    },
  },
});
