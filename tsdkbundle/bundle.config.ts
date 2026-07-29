import type { BundleConfigFn, BundleConfig } from "./src/types";

export default (({ command }): BundleConfig => {
  // command will be either "dev" or "build"
  const isProd = command === "build";

  return {
    default: ["api"],
    projects: {
      api: {
        target: "node",
        entry: ["demo/index.demo.ts"],
        tsconfig: "tsconfig.json",
        outdir: "dist",
        envFile: ".env",
        external: ["pg", "bcrypt"],

        sourcemap: isProd ? "none" : "linked",
        minify: isProd,

        port: 3001,
      },
      worker: {
        target: "node",
        entry: ["src/index.ts", "src/worker.ts"],
        main: "src/index.ts",
        outdir: "dist/worker",
        external: ["bullmq"],

        sourcemap: isProd ? "none" : "linked",
        minify: isProd,
      },
      web: {
        target: "browser",
        entry: "./demo/index.html",
        main: "src/index.ts",
        outdir: "dist/worker",
        external: ["bullmq"],

        sourcemap: isProd ? "none" : "linked",
        minify: isProd,

        port: 3002,
      },
    },
  };
}) satisfies BundleConfigFn;
