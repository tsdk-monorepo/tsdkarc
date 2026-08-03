import { createFileRoute } from "@tanstack/react-router";

import { toNextRouteHandlers } from "tsdkarc-x/fetch";
import { transport } from "@/tsdkarc/main";

const { GET, POST } = toNextRouteHandlers(transport);

export const Route = createFileRoute("/api/arcx/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return GET(request);
      },
      POST: async ({ request }) => {
        return POST(request);
      },
    },
  },
});
