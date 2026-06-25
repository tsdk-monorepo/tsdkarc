import Koa from "koa";
import Router, { RouterContext } from "@koa/router";
import bodyParser from "@koa/bodyparser";
import multer from "@koa/multer";
import fs from "fs";
import nodePath from "path";
import os from "os";
import { PassThrough } from "node:stream";
import type {
  Transport,
  ListenOptions,
  RouteHandler,
  ReqMeta,
} from "./interface";
import { z } from "zod";

const DEFAULT_FILE_SIZE_LIMIT = 100 * 1024 * 1024;

// 1. Isolate temp files to prevent OS-level deletion!
const TEMP_DIR = nodePath.join(os.tmpdir(), "arc-uploads");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── Multer disk storage ──────────────────────────────────────────────────────

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, file, cb) => {
    const ext = nodePath.extname(file.originalname);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, unique);
  },
});

function makeUpload(fileSizeLimit: number) {
  return multer({ storage: diskStorage, limits: { fileSize: fileSizeLimit } });
}

// ─── File cleanup ─────────────────────────────────────────────────────────────

async function cleanupFiles(paths: string[]) {
  await Promise.all(paths.map((p) => fs.promises.unlink(p).catch(() => {})));
}

function sweepStaleTempFiles(maxAgeMs = 60 * 60 * 1000) {
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

// ─── multerToObject ───────────────────────────────────────────────────────────

function multerToObject(
  body: Record<string, unknown>,
  files: multer.File[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      try {
        result[key] = JSON.parse(value);
      } catch {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }
  for (const file of files) {
    const existing = result[file.fieldname];
    if (existing !== undefined) {
      result[file.fieldname] = Array.isArray(existing)
        ? [...existing, file]
        : [existing, file];
    } else {
      result[file.fieldname] = file;
    }
  }
  return result;
}

export const zKoaFile = z.object({
  fieldname: z.string(),
  originalname: z.string(),
  mimetype: z.string(),
  path: z.string(),
  size: z.number(),
});
export type KoaFileInput = z.infer<typeof zKoaFile>;

// ─── Transport ────────────────────────────────────────────────────────────────

export interface KoaTransportOptions {
  defaultFileSizeLimit?: number;
  fileSizeLimits?: Record<string, number>;
  tempSweepIntervalMs?: number;
  tempMaxAgeMs?: number;
}

export function koaTransport(
  app: Koa,
  opts: KoaTransportOptions = {}
): Transport<Koa> {
  const router = new Router();
  const defaultLimit = opts.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
  const tempMaxAgeMs = opts.tempMaxAgeMs ?? 60 * 60 * 1000;

  app.use(bodyParser());

  return {
    app,
    register(path, method, handler) {
      console.log(`[koa] register ${method} ${path}`);
      const routeUpload = makeUpload(
        opts.fileSizeLimits?.[path] ?? defaultLimit
      );

      const routeHandler = async (ctx: RouterContext) => {
        let tempPaths: string[] = [];
        try {
          let body: unknown;
          if (method === "GET") {
            // 2. Parse GET Query Params correctly
            const parsedQuery: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(ctx.query)) {
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
          } else if (
            (ctx.headers["content-type"] ?? "").includes("multipart/form-data")
          ) {
            const files = (ctx.files as multer.File[]) ?? [];
            tempPaths = files.map((f) => f.path);
            body = multerToObject(
              (ctx.request.body as Record<string, unknown>) ?? {},
              files
            );
          } else {
            body = ctx.request.body;
          }
          const meta: ReqMeta = { headers: ctx.headers, raw: ctx, state: {} };
          ctx.body = await handler(body, meta);
        } catch (err: any) {
          ctx.status = err?.status ?? 500;
          ctx.body = err?.details
            ? { error: "Validation failed", details: err.details }
            : { error: err.message ?? "Internal server error" };
          console.error(`[koa] ${method} ${path} error:`, err.message);
        } finally {
          if (tempPaths.length) await cleanupFiles(tempPaths);
        }
      };

      if (method === "GET") router.get(path, routeHandler);
      else router.post(path, routeUpload.any(), routeHandler);
    },

    // 3. Add proper Stream Support for Koa via PassThrough
    registerStream(path, handler) {
      console.log(`[koa] register STREAM ${path}`);
      router.post(path, async (ctx) => {
        ctx.request.socket.setTimeout(0);
        ctx.req.socket.setNoDelay(true);
        ctx.req.socket.setKeepAlive(true);

        ctx.set("Content-Type", "text/event-stream");
        ctx.set("Cache-Control", "no-cache");
        ctx.set("Connection", "keep-alive");

        const stream = new PassThrough();
        ctx.status = 200;
        ctx.body = stream;

        // Run generator in background so we can immediately return the stream to Koa
        (async () => {
          try {
            const meta: ReqMeta = { headers: ctx.headers, raw: ctx, state: {} };
            for await (const chunk of handler(ctx.request.body ?? {}, meta)) {
              stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            stream.write(`data: ${JSON.stringify({ __done: true })}\n\n`);
          } catch (err: any) {
            stream.write(
              `data: ${JSON.stringify({
                __error: err.message,
                __status: err?.status ?? 500,
              })}\n\n`
            );
          } finally {
            stream.end();
          }
        })();
      });
    },

    mount({
      port = 3000,
      hostname = "localhost",
      onListen,
    }: ListenOptions = {}) {
      sweepStaleTempFiles(tempMaxAgeMs);
      const intervalMs = opts.tempSweepIntervalMs ?? 60 * 60 * 1000;
      if (intervalMs > 0)
        setInterval(
          () => sweepStaleTempFiles(tempMaxAgeMs),
          intervalMs
        ).unref();

      app.use(router.routes()).use(router.allowedMethods());
      app.listen(port, hostname, () => onListen?.({ port, hostname }));
    },
  };
}
