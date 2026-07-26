/**
 * All public types for tsdkbundle.
 * Import `BundleConfig`, `BundleConfigFn`, or `BundleConfigExport`
 * in your bundle.config.ts for full type safety.
 */

import type { BunPlugin } from "bun";

export type SourcemapMode = "none" | "inline" | "linked" | "external";

/** Context passed to the bundle config function. */
export interface ConfigContext {
  command: "dev" | "build";
}

/** Per-project configuration block. */
export interface ProjectConfig {
  /** * Bun build target.
   * Defaults to "bun" for backend, "browser" for frontend.
   */
  target?: "bun" | "browser" | "node";

  /** Entry point(s). String or array of strings. */
  entry: string | string[];

  /**
   * The entry file to spawn as the main process in dev mode (backend only).
   * Defaults to the first entry if not specified.
   */
  main?: string;

  /** Path to tsconfig.json for this project. Defaults to "tsconfig.json". */
  tsconfig?: string;

  /** Output directory. Defaults to "dist/<projectName>". */
  outdir?: string;

  /** .env file to load before spawning the process. */
  envFile?: string;

  /** Packages to mark as external (not bundled). */
  external?: string[];

  /** Sourcemap mode. Defaults to "linked" in dev, "none" in build. */
  sourcemap?: SourcemapMode;

  /** Minify output. Defaults to false in dev, false in build. */
  minify?: boolean;

  /** Sets process.env.PORT when spawning the dev process or frontend server. */
  port?: number;

  /** Additional directories to watch for changes. */
  watchDirs?: string[];

  /** ignore files or dirs to watch */
  ignore?: string[];

  /** * Native Bun plugins to apply during the build step.
   * e.g. [yamlPlugin(), cssModulesPlugin()]
   */
  plugins?: BunPlugin[];
}

/** Root config shape for bundle.config.ts */
export interface BundleConfig {
  projects: Record<string, ProjectConfig>;
  default?: string[];
}

/** Function signature for dynamic configuration. */
export type BundleConfigFn = (
  ctx: ConfigContext
) => BundleConfig | Promise<BundleConfig>;

/** What bundle.config.ts is allowed to default export. */
export type BundleConfigExport = BundleConfig | BundleConfigFn;

/** Internal resolved project — all fields guaranteed after config load. */
export interface ResolvedProject {
  name: string;
  target: "bun" | "browser" | "node";
  entry: string[];
  main: string;
  tsconfig: string;
  outdir: string;
  envFile: string | null;
  external: string[];
  sourcemap: SourcemapMode;
  minify: boolean;
  port: number | null;
  watchDirs: string[];
  ignore: string[];
  plugins: BunPlugin[];
}

/** Result of a single Bun.build call. */
export interface BuildResult {
  project: string;
  success: boolean;
  durationMs: number;
  outputs: string[];
  errors: string[];
  warnings: string[];
}

/** Parsed CLI arguments. */
export interface CliArgs {
  command: "dev" | "build";
  projects: string[];
  configPath: string;
  selectAll?: boolean;
}
