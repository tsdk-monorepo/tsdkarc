import type { ResolvedProject, BuildResult } from "./types";

/**
 * Resolves the sourcemap setting for the current mode.
 * In dev mode, "none" is promoted to "linked" so source maps are always available.
 */
function resolveSourcemap(
  mode: "dev" | "build",
  sourcemap: ResolvedProject["sourcemap"]
): ResolvedProject["sourcemap"] {
  if (mode === "dev" && sourcemap === "none") return "linked";
  return sourcemap;
}

export async function buildProject(
  project: ResolvedProject,
  mode: "dev" | "build"
): Promise<BuildResult> {
  const start = performance.now();

  try {
    const result = await Bun.build({
      entrypoints: project.entry,
      outdir: project.outdir,
      target: project.target,
      format: "esm",
      sourcemap: resolveSourcemap(mode, project.sourcemap),
      minify: mode === "build" ? project.minify : false,
      external: project.external,
      plugins: project.plugins,
      ...(project.tsconfig ? { tsconfig: project.tsconfig } : {}),
    });

    const durationMs = Math.round(performance.now() - start);

    if (!result.success) {
      return {
        project: project.name,
        success: false,
        durationMs,
        outputs: [],
        errors: result.logs
          .filter((l) => l.level === "error")
          .map((l) => l.message),
        warnings: result.logs
          .filter((l) => l.level === "warning")
          .map((l) => l.message),
      };
    }

    return {
      project: project.name,
      success: true,
      durationMs,
      outputs: result.outputs.map((o) => o.path),
      errors: [],
      warnings: result.logs
        .filter((l) => l.level === "warning")
        .map((l) => l.message),
    };
  } catch (err) {
    return {
      project: project.name,
      success: false,
      durationMs: Math.round(performance.now() - start),
      outputs: [],
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

export async function buildProjects(
  projects: ResolvedProject[],
  mode: "dev" | "build"
): Promise<BuildResult[]> {
  return Promise.all(projects.map((p) => buildProject(p, mode)));
}
