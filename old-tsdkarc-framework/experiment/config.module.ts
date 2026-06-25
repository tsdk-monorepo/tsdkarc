import { defineModule } from "tsdkarc";

export const configModule = defineModule()({
  name: "config",
  boot: () => ({
    config: {
      port: Number(process.env.PORT) || 3000,
      dbUrl: process.env.DATABASE_URL || "postgres://localhost/app",
      nodeEnv: process.env.NODE_ENV || "development",
    },
  }),
});
