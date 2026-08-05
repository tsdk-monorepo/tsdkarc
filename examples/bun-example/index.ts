import { toFetchHandler } from "tsdkarc-x/fetch";
import { transport } from "./tsdkarc/main";

const fetchHandler = toFetchHandler(transport);

const server = Bun.serve({
  port: 3005,
  fetch(req) {
    if (req.method === "GET") {
      return fetchHandler(req);
    }
    if (req.method === "POST") {
      return fetchHandler(req);
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Backend listening on http://localhost:${server.port}`);
