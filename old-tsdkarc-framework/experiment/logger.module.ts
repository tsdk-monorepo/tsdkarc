import pino from "pino";
import { defineModule } from "tsdkarc";
import { configModule } from "./config.module";

export type Logger = ReturnType<typeof pino>;

export const loggerModule = defineModule()({
  name: "logger",
  modules: [configModule] as const,
  boot(ctx) {
    return {
      logger: pino({
        level: ctx.config.nodeEnv === "production" ? "info" : "debug",
        transport:
          ctx.config.nodeEnv !== "production"
            ? { target: "pino-pretty" }
            : undefined,
      }),
    };
  },
});
