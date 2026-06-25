import { createServer } from "./server/create-server";
import { honoTransport } from "./transport/hono.transport";
import { logMiddleware } from "./middleware";

import { defineModule } from "tsdkarc";
import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";

const ctxModule = defineModule()({
  name: "test",
  boot() {
    return { ctx1: 1 };
  },
});

const ctxModule2 = defineModule()({
  name: "test2",
  boot() {
    return { ctx2: 2 };
  },
});

const { defineRoutes, createApp, app } = createServer({
  prefix: "/x",
  transport: honoTransport(),
  port: 5001,
  middleware: [logMiddleware],
  modules: [ctxModule, ctxModule2],
  onReady(app) {
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/openapi/ui", swaggerUI({ url: "/x/openapi" }));
    app.get(
      "/openapi/scalar",
      Scalar(() => {
        return { url: "/x/openapi" };
      })
    );
  },
});

export { defineRoutes, createApp };
