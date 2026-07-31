import type { BundleConfigFn } from "tsdkbundle";

const config: BundleConfigFn = ({ command }) => {
  // command will be either "dev" or "build"
  const isProd = command === "build";

  return {
    default: ["main"],
    projects: {
      main: {
        target: "node",
        entry: ["./server.ts"],
        tsconfig: "tsconfig.json",
        outdir: "dist",
        envFile: ".env",
        external: [],
        ignore: ["**/*.d.ts", "./dist"],

        // Dynamic config!
        sourcemap: isProd ? "none" : "linked",
        minify: isProd,
      },
    },
  };
};

export default config;
