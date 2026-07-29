/**
 * Static file server for frontend dev mode.
 * Serves files from the project's outdir on the configured port.
 *
 * Input:  ResolvedProject
 * Output: Bun.Server instance (call .stop() to shut down)
 *
 * SPA fallback: requests for non-existent paths fall back to index.html.
 * This covers client-side routing (React Router, etc.).
 */

import { existsSync } from "fs";
import { join, extname } from "path";
import type { ResolvedProject } from "./types";

/** MIME type map for common web assets. */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".map":  "application/json",
};

function getMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/**
 * Start a static file server for the given frontend project.
 * Returns the Bun.Server so the caller can stop it on shutdown.
 */
export function startDevServer(project: ResolvedProject): ReturnType<typeof Bun.serve> {
  const port = project.port ?? 3000;
  const outdir = project.outdir;

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let pathname = decodeURIComponent(url.pathname);

      // Normalize root to index.html
      if (pathname === "/" || pathname === "") {
        pathname = "/index.html";
      }

      const filePath = join(outdir, pathname);

      // Serve exact file if it exists
      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        return new Response(file, {
          headers: { "Content-Type": getMime(filePath) },
        });
      }

      // SPA fallback: serve index.html for unknown paths
      const indexPath = join(outdir, "index.html");
      if (existsSync(indexPath)) {
        const file = Bun.file(indexPath);
        return new Response(file, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
    error(err) {
      console.error("[dev-server] unhandled error:", err.message);
      return new Response("Internal server error", { status: 500 });
    },
  });
}
