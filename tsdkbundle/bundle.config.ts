import type { BundleConfigFn } from "./src/types";

export default (({ command }) => {
  // command will be either "dev" or "build"
  const isProd = command === "build";

  return {
    default: ["api"],
    projects: {
      api: {
        type: "backend",
        entry: ["src/index.demo.ts"],
        tsconfig: "tsconfig.json",
        outdir: "dist",
        envFile: ".env",
        external: ["pg", "bcrypt"],

        // Dynamic config!
        sourcemap: isProd ? "none" : "linked",
        minify: isProd,

        port: 3001,
      },
      worker: {
        type: "backend",
        entry: ["src/index.ts", "src/worker.ts"],
        main: "src/index.ts",
        outdir: "dist/worker",
        external: ["bullmq"],

        // Dynamic config!
        sourcemap: isProd ? "none" : "linked",
        minify: isProd,

        port: 3002,
      },
    },
  };
}) satisfies BundleConfigFn;
