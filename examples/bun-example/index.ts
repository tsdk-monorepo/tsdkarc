import { toNextRouteHandlers } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

export const { GET, POST } = toNextRouteHandlers(transport);

const server = Bun.serve({
  port: 3005,
  fetch(req) {
    if (req.method === "GET") {
      return GET(req);
    }
    if (req.method === "POST") {
      return POST(req);
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Backend listening on http://localhost:${server.port}`);
