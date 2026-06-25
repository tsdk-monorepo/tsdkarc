import type { Transport } from "../transport/interface";
import type { Middleware } from "../server";

/**
 * Base context injected into every route handler.
 * TApp is the native framework app type — fully typed, never any.
 */
export interface ArcCtx<TApp = unknown> {
  transport: Transport<TApp>;
}

export type { Middleware };
