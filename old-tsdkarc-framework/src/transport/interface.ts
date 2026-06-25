import { z } from "zod";

// export interface ReqMeta<Raw = unknown, State = Record<string, unknown>> {
//   /** Standardized headers object (lowercased keys) */
//   headers: Record<string, string | string[] | undefined>;
//   /** * The raw framework request object (escape hatch).
//    * Cast it to `Context` (Hono), `express.Request`, or `RouterContext` (Koa) when needed.
//    */
//   raw?: Raw;
//   /** Safe space for middleware to inject data (e.g., user sessions) */
//   state: State;
// }

function meta<Raw = unknown, State = Record<string, unknown>>() {
  return {} as {
    /** Standardized headers object (lowercased keys) */
    headers: Record<string, string | string[] | undefined>;
    /** * The raw framework request object (escape hatch).
     * Cast it to `Context` (Hono), `express.Request`, or `RouterContext` (Koa) when needed.
     */
    raw?: Raw;
    /** Safe space for middleware to inject data (e.g., user sessions) */
    state: State;
  };
}

export type ReqMeta<Raw = unknown> = typeof meta<Raw>;

export interface Transport<App = unknown, Raw = unknown> {
  app: App;
  register(
    path: string,
    method: "GET" | "POST",
    handler: (body: unknown, meta: ReqMeta<Raw>) => Promise<unknown>
  ): void;
  registerStream(
    path: string,
    handler: (body: unknown, meta: ReqMeta<Raw>) => AsyncGenerator<unknown>
  ): void;
  mount(opts?: ListenOptions): void;
}

export interface ListenOptions {
  port?: number;
  hostname?: string;
  onListen?: (info: { port: number; hostname: string }) => void;
}

export type RouteHandler<Raw = unknown> = (
  body: unknown,
  meta: ReqMeta<Raw>
) => Promise<unknown>;
export type StreamHandler = (
  body: unknown,
  meta: ReqMeta
) => AsyncIterable<unknown>;

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  path: string;
  size: number;
}

export const zUploadedFile = z.object({
  fieldname: z.string(),
  originalname: z.string(),
  mimetype: z.string(),
  path: z.string(),
  size: z.number(),
});
