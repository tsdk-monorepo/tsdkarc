import type { Transport } from "../transport/interface";
import type { ArcCtx, Middleware } from "./types";
import type { AnyModule } from "tsdkarc";
import { ArcOptions, createArcModule } from "../server/server";

/**
 * Creates an arc bound to a Transport<TApp>.
 * TApp is inferred from the transport argument — no annotation needed.
 *
 * @param transport  Framework transport (honoTransport, fastifyTransport…)
 * @param opts       Shared middleware and modules applied to all routes
 */
export function createArc<TApp, const M extends readonly AnyModule[] = []>(
  transport: Transport<TApp>,
  opts: ArcOptions & {
    modules?: M;
  } = {}
) {
  return createArcModule<M>(transport, {
    prefix: opts?.prefix,
    middleware: opts.middleware ?? [],
    modules: (opts.modules ?? []) as M,
  });
}
