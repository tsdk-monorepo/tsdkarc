// ─── hook-utils.ts ────────────────────────────────────────────────────────────
// Shared runtime utilities for SWR and TanStack hook adapters.
// Extracted to eliminate duplication between the two adapters.

export type AnyFn = (...args: any[]) => Promise<any>;

export type AnyStreamFn = (...args: any[]) => AsyncGenerator<any>;

export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

// export type Routes<Ctx> = Ctx["routes" & keyof Ctx];
export type Routes<Ctx> = Ctx extends { ___routes: infer R } ? R : never;

export type KindOf<F> = ReturnType<
  F extends (...args: any[]) => any ? F : never
> extends Promise<any> & { __kind: infer K }
  ? K
  : ReturnType<
      F extends (...args: any[]) => any ? F : never
    > extends AsyncGenerator<any> & { __kind: "stream" }
  ? "stream"
  : "query";

// Add these to hook fn types section

// Helper to extract the yielded type from an AsyncGenerator
type YieldOf<F> = ReturnType<
  F extends (...args: any[]) => any ? F : never
> extends AsyncGenerator<infer Y, any, any>
  ? Y
  : never;

// The return payload for our custom stream hook
export type UseStreamResult<Y, Args extends any[]> = {
  data: Y[];
  isStreaming: boolean;
  error: Error | null;
  // 👈 `.start()` now strictly checks if the payload is required!
  start: Args extends []
    ? () => Promise<void>
    : [] extends Args
    ? (data?: Expand<NonNullable<Args[0]>>) => Promise<void>
    : (data: Expand<Args[0]>) => Promise<void>;
  reset: () => void;
};

// The Hook Signature
export type StreamHookFn<F> = F extends (...args: infer Args) => any
  ? Args extends []
    ? () => UseStreamResult<YieldOf<F>, Args>
    : [] extends Args
    ? (
        defaultData?: Expand<NonNullable<Args[0]>>
      ) => UseStreamResult<YieldOf<F>, Args>
    : (defaultData?: Expand<Args[0]>) => UseStreamResult<YieldOf<F>, Args>
  : never;
