import express, { Express } from "express";
import multer from "multer";
import fs from "fs";
import nodePath from "path";
import os from "os";
import type {
  Transport,
  ListenOptions,
  RouteHandler,
  ReqMeta,
} from "./interface";
import { z } from "zod";

const DEFAULT_FILE_SIZE_LIMIT = 100 * 1024 * 1024; // 100MB

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

async function cleanupFiles(files: Express.Multer.File[]) {
  await Promise.all(
    files.map((file) => fs.promises.unlink(file.path).catch(() => {}))
  );
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
  files: Express.Multer.File[]
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

export const zDiskFile = z.object({
  fieldname: z.string(),
  originalname: z.string(),
  mimetype: z.string(),
  path: z.string(),
  size: z.number(),
});
export type DiskFile = z.infer<typeof zDiskFile>;

// ─── Transport ────────────────────────────────────────────────────────────────

export interface ExpressTransportOptions {
  defaultFileSizeLimit?: number;
  fileSizeLimits?: Record<string, number>;
  tempSweepIntervalMs?: number;
  tempMaxAgeMs?: number;
}

export function expressTransport(
  app: ReturnType<typeof express>,
  opts: ExpressTransportOptions = {}
): Transport<Express> {
  app.use(express.json());
  const defaultLimit = opts.defaultFileSizeLimit ?? DEFAULT_FILE_SIZE_LIMIT;
  const tempMaxAgeMs = opts.tempMaxAgeMs ?? 60 * 60 * 1000;

  return {
    app,
    register(path, method, handler) {
      console.log(`[express] register ${method} ${path}`);

      const routeHandler = async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        try {
          let body: unknown = req.body;
          if (method === "GET") {
            // 2. Parse GET Query Params correctly
            const parsedQuery: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(req.query)) {
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
          }
          const raw = { req, res };
          const meta: ReqMeta<typeof raw> = () => ({
            headers: req.headers,
            raw,
            state: {},
          });
          res.json(await handler(body, meta));
        } catch (err) {
          next(err);
        }
      };

      if (method === "GET") return app.get(path, routeHandler);

      const routeUpload = makeUpload(
        opts.fileSizeLimits?.[path] ?? defaultLimit
      );
      const multerAny = routeUpload.any() as any;

      app.post(path, (req, res, next) => {
        if (
          !(req.headers["content-type"] ?? "").includes("multipart/form-data")
        ) {
          return routeHandler(req, res, next);
        }
        multerAny(req, res, (err: any) => {
          const files = (req.files as Express.Multer.File[]) ?? [];
          if (err) {
            cleanupFiles(files);
            return err instanceof multer.MulterError
              ? res
                  .status(400)
                  .json({ error: "Upload failed", details: err.message })
              : next(err);
          }
          const body = multerToObject(req.body ?? {}, files);
          const raw = { req, res };
          const meta: ReqMeta<typeof raw> = () => ({
            headers: req.headers,
            raw,
            state: {},
          });
          handler(body, meta)
            .then((result) => res.json(result))
            .catch(next)
            .finally(() => cleanupFiles(files));
        });
      });
    },

    // 3. Add proper Stream Support for Express
    registerStream(path, handler) {
      console.log(`[express] register STREAM ${path}`);
      app.post(path, async (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          const raw = { req, res };
          const meta: ReqMeta<typeof raw> = () => ({
            headers: req.headers,
            raw,
            state: {},
          });
          for await (const chunk of handler(req.body ?? {}, meta)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ __done: true })}\n\n`);
        } catch (err: any) {
          res.write(
            `data: ${JSON.stringify({
              __error: err.message,
              __status: err?.status ?? 500,
            })}\n\n`
          );
        } finally {
          res.end();
        }
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

      app.use(
        (
          err: any,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction
        ) => {
          console.error("[express] unhandled error:", err.message);
          res
            .status(err?.status ?? 500)
            .json(
              err?.details
                ? { error: "Validation failed", details: err.details }
                : { error: err?.message || "Internal server error" }
            );
        }
      );
      app.listen(port, hostname, () => onListen?.({ port, hostname }));
    },
  };
}
