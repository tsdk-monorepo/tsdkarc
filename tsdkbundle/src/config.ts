import { existsSync } from "fs";
import { resolve, dirname, join } from "path";
import type { BundleConfig, ProjectConfig, ResolvedProject } from "./types";

export interface ConfigLoadResult {
  projects: Record<string, ResolvedProject>;
  defaultProjects: string[];
}

export interface ConfigError {
  field: string;
  message: string;
}

export class ConfigValidationError extends Error {
  constructor(public errors: ConfigError[]) {
    super(
      `bundle.config validation failed:\n${errors.map((e) => `  [${e.field}] ${e.message}`).join("\n")}`
    );
    this.name = "ConfigValidationError";
  }
}

export function findConfigPath(cwd: string): string | null {
  for (const name of ["bundle.config.ts", "bundle.config.js", "bundle.config.json"]) {
    const full = join(cwd, name);
    if (existsSync(full)) return full;
  }
  return null;
}

function validateProject(name: string, proj: ProjectConfig, errors: ConfigError[]) {
  const prefix = `projects.${name}`;

  if (proj.type !== "backend" && proj.type !== "frontend") {
    errors.push({ field: `${prefix}.type`, message: 'Must be "backend" or "frontend"' });
  }
  if (!proj.entry || (Array.isArray(proj.entry) && proj.entry.length === 0)) {
    errors.push({ field: `${prefix}.entry`, message: "Must provide at least one entry file" });
  }
}

export async function loadConfig(
  configPath: string,
  command: "dev" | "build"
): Promise<ConfigLoadResult> {
  const abs = resolve(configPath);
  const configDir = dirname(abs);

  if (!existsSync(abs)) throw new Error(`Config file not found: ${abs}`);

  let raw: BundleConfig;
  if (abs.endsWith(".json")) {
    raw = JSON.parse(await Bun.file(abs).text()) as BundleConfig;
  } else {
    const mod = await import(`${abs}?t=${Date.now()}`);
    const configExport = mod.default ?? mod;
    
    // Resolve dynamic config function if present
    if (typeof configExport === "function") {
      raw = await configExport({ command });
    } else if (configExport && typeof configExport === "object") {
      raw = configExport as BundleConfig;
    } else {
      throw new Error(`Config file must export an object or a function.`);
    }
  }

  const errors: ConfigError[] = [];
  if (!raw.projects || typeof raw.projects !== "object") {
    errors.push({ field: "projects", message: "Must be an object mapping names to project configs" });
    throw new ConfigValidationError(errors);
  }

  for (const [name, proj] of Object.entries(raw.projects)) {
    validateProject(name, proj, errors);
  }

  if (errors.length > 0) throw new ConfigValidationError(errors);

  const projects: Record<string, ResolvedProject> = {};
  for (const [name, proj] of Object.entries(raw.projects)) {
    const entries = Array.isArray(proj.entry) ? proj.entry : [proj.entry];
    const outdir = resolve(configDir, proj.outdir ?? `dist/${name}`);
    const mainEntry = proj.main ?? entries[0] as string;
    const mainJs = resolve(outdir, mainEntry.split("/").pop()!.replace(/\.[tj]sx?$/, ".js"));

    projects[name] = {
      name,
      type: proj.type,
      target: proj.target ?? (proj.type === "frontend" ? "browser" : "bun"),
      entry: entries.map((e) => resolve(configDir, e)),
      main: mainJs,
      tsconfig: resolve(configDir, proj.tsconfig ?? "tsconfig.json"),
      outdir,
      envFile: proj.envFile ? resolve(configDir, proj.envFile) : null,
      external: proj.external ?? [],
      sourcemap: proj.sourcemap ?? "linked",
      minify: proj.minify ?? false,
      port: proj.port ?? null,
      watchDirs: (proj.watchDirs ?? []).map((d) => resolve(configDir, d)),
      ignore: (proj.ignore ?? []),
      plugins: proj.plugins ?? [], // Pass through the plugins
    };
  }

  return { projects, defaultProjects: raw.default ?? [] };
}