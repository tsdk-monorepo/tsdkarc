import type { BundleConfigFn } from "tsdkbundle";

const config: BundleConfigFn = (({ command }) => {
  // command will be either "dev" or "build"
  const isProd = command === "build";

  return {
    default: ["api"],
    projects: {
      api: {
        target: "bun",
        entry: ["scripts/demo/demo.ts"],
        tsconfig: "tsconfig.json",
        outdir: "dist",
        envFile: ".env",
        external: ["pg", "bcrypt"],
        ignore: ['*.d.ts'],

        // Dynamic config!
        sourcemap: isProd ? "none" : "linked",
        minify: isProd,

        port: 3010,
      },
    },
  };
});

export default config;