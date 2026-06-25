import { Hono, type Context } from "hono";
import { stream as honoStream } from "hono/streaming";
import { serve } from "@hono/node-server";
import fs from "fs";
import nodePath from "path";
import os from "os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type {
  Transport,
  ListenOptions,
  RouteHandler,
  UploadedFile,
  ReqMeta,
} from "./interface";

const DEFAULT_FILE_SIZE_LIMIT = 100 * 1024 * 1024;

// 1. Isolate temp files into a dedicated directory to prevent sweeping OS files!
const TEMP_DIR = nodePath.join(os.tmpdir(), "arcx-uploads");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export interface HonoTransportOptions {
  defaultFileSizeLimit?: number;
  fileSizeLimits?: Record<string, number>;
  tempSweepIntervalMs?: number;
  tempMaxAgeMs?: number;
}

// ─── File helpers ─────────────────────────────────────────────────────────────

async function cleanupFiles(paths: string[]) {
  await Promise.all(
    paths.map((p) =>
      fs.promises
        .unlink(p)
        .catch((err) =>
          console.warn(`[upload] failed to delete ${p}:`, err.message)
        )
    )
  );
}

function sweepStaleTempFiles(maxAgeMs: number) {
  // Only sweep our dedicated subfolder, NOT the whole OS tmpdir
  fs.readdir(TEMP_DIR, (_err, files) => {
    if (!files) return;
    const now = Date.now();
    for (const file of files) {
      const filePath = nodePath.join(TEMP_DIR, file);
      fs.stat(filePath, (err, stat) => {
        if (err) return;
        if (now - stat.mtimeMs > maxAgeMs) fs.unlink(filePath, () => {});
      });
    }
  });
}

async function parseFormData(
  formData: FormData,
  fileSizeLimit: number
): Promise<{ data: Record<string, unknown>; tempPaths: string[] }> {
  const result: Record<string, unknown> = {};
  const tempPaths: string[] = [];

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size > fileSizeLimit) {
        await cleanupFiles(tempPaths);
        throw Object.assign(
          new Error(
            `File "${value.name}" exceeds size limit of ${fileSizeLimit} bytes`
          ),
          { status: 413 }
        );
      }

      const ext = nodePath.extname(value.name);
      const unique = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${ext}`;
      const tempPath = nodePath.join(TEMP_DIR, unique);

      // 2. Stream the file directly to disk to prevent RAM blowouts
      // @ts-expect-error Node.js Readable.fromWeb expects a web stream
      const readStream = Readable.fromWeb(value.stream());
      const writeStream = fs.createWriteStream(tempPath);
      await pipeline(readStream, writeStream);

      tempPaths.push(tempPath);

      const uploaded: UploadedFile = {
        fieldname: key,
        originalname: value.name,
        mimetype: value.type,
        path: tempPath,
        size: value.size,
      };

      const existing = result[key];
      result[key] =
        existing === undefined
          ? uploaded
          : Array.isArray(existing)
          ? [...existing, uploaded]
          : [existing, uploaded];
    } else {
      try {
        result[key] = JSON.parse(value as string);
      } catch {
        result[key] = value;
      }
    }
  }
  return { data: result, tempPaths };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function honoTransport(
  opts: HonoTransportOptions = {}
): () => Transport<Hono, Context> {
  return () => {
    const app = new Hono();
    const defaultLimit = opts.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
    const tempMaxAgeMs = opts.tempMaxAgeMs ?? 60 * 60 * 1000;

    function makeHandler(path: string, handler: RouteHandler<Context>) {
      const fileSizeLimit = opts.fileSizeLimits?.[path] ?? defaultLimit;

      return async (c: Context) => {
        let tempPaths: string[] = [];
        try {
          const contentType = c.req.header("content-type") ?? "";
          let body: unknown = {};

          if (c.req.method === "GET") {
            // 3. Parse JSON values out of GET Query Params
            const searchParams = Object.fromEntries(
              new URL(c.req.url).searchParams
            );
            const parsedQuery: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(searchParams)) {
              if (
                typeof v === "string" &&
                (v.startsWith("{") || v.startsWith("["))
              ) {
                try {
                  parsedQuery[k] = JSON.parse(v);
                } catch {
                  parsedQuery[k] = v;
                }
              } else {
                parsedQuery[k] = v;
              }
            }
            body = parsedQuery;
          } else if (contentType.includes("multipart/form-data")) {
            const { data, tempPaths: paths } = await parseFormData(
              await c.req.formData(),
              fileSizeLimit
            );
            tempPaths = paths;
            body = data;
          } else {
            body = await c.req.json().catch(() => ({}));
          }
          const meta: ReqMeta<Context> = () => ({ headers: c.req.header(), raw: c, state: {} });
          const result = await handler(body, meta);
          return c.json(result);
        } catch (err: any) {
          const status = (err?.status || 500) as any; // Cast to bypass Hono strict status types
          const errBody = err?.details
            ? { error: "Validation failed", details: err.details }
            : { error: err?.message ?? "Internal server error" };

          console.error(`[hono] ${c.req.method} ${path} error:`, err.message);
          return c.json(errBody, status);
        } finally {
          if (tempPaths.length) await cleanupFiles(tempPaths);
        }
      };
    }

    return {
      app,

      register(path, method, handler) {
        console.log(`[hono] register ${method} ${path}`);
        const honoHandler = makeHandler(path, handler);
        method === "GET"
          ? app.get(path, honoHandler)
          : app.post(path, honoHandler);
      },

      registerStream(path, handler) {
        console.log(`[hono] register STREAM ${path}`);
        app.post(path, async (c: Context) => {
          const body = await c.req.json().catch(() => ({}));

          // 4. Set required Server-Sent Events (SSE) headers
          c.header("Content-Type", "text/event-stream");
          c.header("Cache-Control", "no-cache");
          c.header("Connection", "keep-alive");

          return honoStream(c, async (stream) => {
            try {
              const meta = { headers: c.req.header(), raw: c, state:{} };
              for await (const chunk of handler(body, () => meta)) {
                await stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
              await stream.write(
                `data: ${JSON.stringify({ __done: true })}\n\n`
              );
            } catch (err: any) {
              await stream.write(
                `data: ${JSON.stringify({
                  __error: err.message,
                  __status: err?.status ?? 500,
                })}\n\n`
              );
            }
          });
        });
      },

      mount({
        port = 3000,
        hostname = "localhost",
        onListen,
      }: ListenOptions = {}) {
        sweepStaleTempFiles(tempMaxAgeMs);
        const intervalMs = opts.tempSweepIntervalMs ?? 60 * 60 * 1000;

        if (intervalMs > 0) {
          setInterval(
            () => sweepStaleTempFiles(tempMaxAgeMs),
            intervalMs
          ).unref();
        }

        serve({ fetch: app.fetch, port, hostname }, (info: { port: number }) =>
          onListen?.({ port: info.port, hostname })
        );
      },
    };
  };
}
