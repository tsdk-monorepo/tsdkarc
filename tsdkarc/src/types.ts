// ─────────────────────────────────────────────────────────────────────────────
// Utility types
// ─────────────────────────────────────────────────────────────────────────────

export type Simplify<T> = T extends object ? { [K in keyof T]: T[K] } : T;

/** Converts A | B | C into A & B & C */
export type UnionToIntersection<U> = (
  U extends any ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

/**
 * Recursively merges two object types. (Optimized)
 * Uses a single mapped type to avoid Omit, Exclude, and Intersection costs.
 * It natively produces a simplified/flat object.
 */
export type DeepMerge<A extends object, B extends object> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? A[K] extends object
        ? B[K] extends object
          ? DeepMerge<A[K] & object, B[K] & object>
          : B[K]
        : B[K]
      : B[K] // B only
    : K extends keyof A
    ? A[K] // A only
    : never;
};

/**
 * Merges two object types. (Optimized)
 * Uses a single mapped type, avoiding Omit and intermediate Simplify calls.
 */
export type MergeCtx<
  A extends object,
  B extends object,
  Ignored extends string = never
> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? K extends keyof A
      ? K extends Ignored
        ? A[K] extends object
          ? B[K] extends object
            ? DeepMerge<A[K] & object, B[K] & object>
            : B[K]
          : B[K]
        : never // Collision error signal
      : B[K] // B only
    : K extends keyof A
    ? A[K] // A only
    : never;
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural Base Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface AnyModule {
  readonly _kind: "named" | "anon";
  readonly _name: string | null;
  readonly _depCtx: object;
  readonly _ownSlice: object;
}

export interface AnyNamedModule extends AnyModule {
  readonly _kind: "named";
  readonly _name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Extraction
// ─────────────────────────────────────────────────────────────────────────────

export type ContextOf<M extends AnyModule> = Simplify<
  M["_kind"] extends "named"
    ? M["_depCtx"] & { [K in Extract<M["_name"], string>]: M["_ownSlice"] }
    : M["_depCtx"] & M["_ownSlice"]
>;

export type CtxContribution<M extends AnyModule> = M["_kind"] extends "named"
  ? { [K in M["_name"] & string]: M["_ownSlice"] }
  : ContextOf<M>;

export type DepCtxOf<M extends AnyModule> = M["_depCtx"];
export type OwnSliceOf<M extends AnyModule> = M["_ownSlice"];

// ─────────────────────────────────────────────────────────────────────────────
// Ctx accumulation over a module tuple
// ─────────────────────────────────────────────────────────────────────────────

export type AccumulateCtx<
  Modules extends AnyModule[],
  Ignored extends string = never,
  Acc extends object = {}
> = number extends Modules["length"]
  ? UnionToIntersection<CtxContribution<Modules[number]>> & object
  : Modules extends [
      infer Head extends AnyModule,
      ...infer Tail extends AnyModule[]
    ]
  ? AccumulateCtx<Tail, Ignored, MergeCtx<Acc, CtxContribution<Head>, Ignored>>
  : Acc;

export type FullCtxOf<
  Modules extends AnyModule[],
  Ignored extends string = never
> = Simplify<AccumulateCtx<Modules, Ignored>> & object;

// ─────────────────────────────────────────────────────────────────────────────
// DepCtx & External Deps
// ─────────────────────────────────────────────────────────────────────────────

export type DepCtxFromList<
  Deps extends AnyModule[],
  Ignored extends string = never
> = Deps extends [] ? {} : Simplify<AccumulateCtx<Deps, Ignored>> & object;

export type ExternalDepsOf<
  Modules extends AnyModule[],
  Ignored extends string = never
> = Simplify<
  Omit<
    UnionToIntersection<DepCtxOf<Modules[number]>> & object,
    keyof FullCtxOf<Modules, Ignored>
  >
> &
  object;

// ─────────────────────────────────────────────────────────────────────────────
// PostBootCtx
// ─────────────────────────────────────────────────────────────────────────────

export type PostBootCtx<
  DepCtx extends object,
  Name extends string | null,
  OwnSlice extends object
> = Simplify<
  Name extends string
    ? DepCtx & { [K in Name]: Simplify<OwnSlice> }
    : DepCtx & Simplify<OwnSlice>
>;

// ─────────────────────────────────────────────────────────────────────────────
// .with() result helpers
// ─────────────────────────────────────────────────────────────────────────────

export type AddResult<
  M extends AnyModule,
  Modules extends AnyModule[],
  Ignored extends string = never
> = AnonModule<
  ExternalDepsOf<[M, ...Modules], Ignored>,
  FullCtxOf<[M, ...Modules], Ignored>,
  Ignored
>;

export type AddNamedResult<
  GroupName extends string,
  M extends AnyModule,
  Modules extends AnyModule[],
  Ignored extends string = never
> = NamedModule<
  GroupName,
  ExternalDepsOf<[M, ...Modules], Ignored>,
  FullCtxOf<[M, ...Modules], Ignored>,
  Ignored
>;

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate name detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optimized check: Excludes Ignored keys once per tuple item rather than branching.
 */
export type FindDuplicateName<
  Modules extends readonly AnyModule[],
  Ignored extends string = never,
  Seen extends string = never
> = Modules extends readonly [
  infer Head extends AnyModule,
  ...infer Tail extends AnyModule[]
]
  ? Exclude<ContributedKeys<Head>, Ignored> extends infer HKeys extends string
    ? [HKeys & Seen] extends [never]
      ? FindDuplicateName<Tail, Ignored, Seen | HKeys>
      : DuplicateNameError<HKeys & Seen>
    : never
  : null;

type ContributedKeys<M extends AnyModule> = M["_kind"] extends "named"
  ? M["_name"] & string
  : keyof M["_ownSlice"] & string;

// ─────────────────────────────────────────────────────────────────────────────
// Module identity interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface NamedModule<
  Name extends string,
  DepCtx extends object,
  OwnSlice extends object,
  Ignored extends string = never
> extends AnyNamedModule {
  readonly _kind: "named";
  readonly _name: Name;
  readonly _depCtx: DepCtx;
  readonly _ownSlice: OwnSlice;

  graph(): {
    nodes: ModuleGraphNode;
    readonly formatted: string;
  };

  with<Modules extends AnyModule[]>(
    ...modules: FindDuplicateName<
      [NamedModule<Name, DepCtx, OwnSlice, Ignored>, ...Modules],
      Ignored
    > extends infer Err extends string
      ? [collisionError: Err]
      : Modules
  ): AddResult<NamedModule<Name, DepCtx, OwnSlice, Ignored>, Modules, Ignored>;

  with<Modules extends [AnyModule, ...AnyModule[]], GroupName extends string>(
    ...args: FindDuplicateName<
      [NamedModule<Name, DepCtx, OwnSlice, Ignored>, ...Modules],
      Ignored
    > extends infer Err extends string
      ? [collisionError: Err]
      : [...Modules, options: { name: GroupName }]
  ): AddNamedResult<
    GroupName,
    NamedModule<Name, DepCtx, OwnSlice, Ignored>,
    Modules,
    Ignored
  >;

  start<Reason = string>(
    options?: StartOptions<DepCtx & { [K in Name]: OwnSlice }, Reason>
  ): Promise<StartResult<DepCtx & { [K in Name]: OwnSlice }, Reason>>;
}

export interface AnonModule<
  DepCtx extends object,
  OwnSlice extends object,
  Ignored extends string = never
> extends AnyModule {
  readonly _kind: "anon";
  readonly _name: null;
  readonly _depCtx: DepCtx;
  readonly _ownSlice: OwnSlice;

  /** Returns this module's dependency graph, rooted at itself. */
  graph(): {
    nodes: ModuleGraphNode;
    readonly formatted: string;
  };

  with<Modules extends [AnyModule, ...AnyModule[]]>(
    ...modules: FindDuplicateName<
      [AnonModule<DepCtx, OwnSlice, Ignored>, ...Modules],
      Ignored
    > extends infer Err extends string
      ? [collisionError: Err]
      : Modules
  ): AddResult<AnonModule<DepCtx, OwnSlice, Ignored>, Modules, Ignored>;

  start<Reason = string>(
    options?: StartOptions<DepCtx & OwnSlice, Reason>
  ): Promise<StartResult<DepCtx & OwnSlice, Reason>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// start() types
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleMeta {
  name: string | null;
  kind: "named" | "anon";
}

export interface StartOptions<FinalCtx extends object, Reason = string> {
  beforeBoot?: (ctx: Record<never, never>) => any;
  afterBoot?: (ctx: FinalCtx) => any;
  beforeShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  afterShutdown?: (ctx: FinalCtx, reason?: Reason) => any;
  beforeEachBoot?: (ctx: object, module: ModuleMeta) => any;
  afterEachBoot?: (ctx: object, module: ModuleMeta) => any;
  beforeEachShutdown?: (
    ctx: object,
    module: ModuleMeta,
    reason?: Reason
  ) => any;
  afterEachShutdown?: (ctx: object, module: ModuleMeta, reason?: Reason) => any;
}

export interface StartResult<FinalCtx extends object, Reason = string> {
  ctx: FinalCtx;
  stop: (reason?: Reason) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Lifecycle & Declaration
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleLifecycleHooks<
  DepCtx extends object,
  Name extends string | null,
  OwnSlice extends object,
  Reason = string
> {
  shutdown?: (ctx: PostBootCtx<DepCtx, Name, OwnSlice>, reason?: Reason) => any;
  beforeBoot?: (ctx: DepCtx) => any;
  afterBoot?: (ctx: PostBootCtx<DepCtx, Name, OwnSlice>) => any;
  beforeShutdown?: (
    ctx: PostBootCtx<DepCtx, Name, OwnSlice>,
    reason?: Reason
  ) => any;
  afterShutdown?: (
    ctx: PostBootCtx<DepCtx, Name, OwnSlice>,
    reason?: Reason
  ) => any;
}

export interface ModuleDeclaration<
  Name extends string | null,
  DepCtx extends object,
  Ignored extends string = never
> {
  init<OwnSlice extends object = {}>(
    bootFn?: FindSliceCollision<DepCtx, OwnSlice> extends string
      ? FindSliceCollision<DepCtx, OwnSlice>
      : (ctx: DepCtx) => OwnSlice | Promise<OwnSlice> | void | Promise<void>,
    hooks?: ModuleLifecycleHooks<DepCtx, Name, OwnSlice>
  ): Name extends string
    ? NamedModule<Name & string, DepCtx, OwnSlice, Ignored>
    : AnonModule<DepCtx, OwnSlice, Ignored>;

  start<Reason = string>(
    options?: StartOptions<
      Name extends string ? DepCtx & { [K in Name & string]: {} } : DepCtx,
      Reason
    >
  ): Promise<
    StartResult<
      Name extends string ? DepCtx & { [K in Name & string]: {} } : DepCtx,
      Reason
    >
  >;

  with<Modules extends AnyModule[]>(
    ...modules: FindDuplicateName<
      [
        Name extends string
          ? NamedModule<Name & string, DepCtx, {}, Ignored>
          : AnonModule<DepCtx, {}, Ignored>,
        ...Modules
      ],
      Ignored
    > extends infer Err extends string
      ? [collisionError: Err]
      : Modules
  ): Name extends string
    ? AddResult<
        NamedModule<Name & string, DepCtx, {}, Ignored>,
        Modules,
        Ignored
      >
    : AddResult<AnonModule<DepCtx, {}, Ignored>, Modules, Ignored>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collision detection helpers
// ─────────────────────────────────────────────────────────────────────────────

export type NameCollisionError<N extends string> =
  `Error: Name '${N}' is already used by a dependency.`;

export type DuplicateNameError<N extends string> =
  `Error: Duplicate module name '${N}' detected in array.`;

export type FindSliceCollision<
  DepCtx extends object,
  OwnSlice extends object
> = keyof OwnSlice & keyof DepCtx extends never
  ? null
  : keyof OwnSlice & keyof DepCtx extends infer K extends string
  ? `Error: Key '${K}' in module's return value already exists in dep context.`
  : null;

export type MapTupleToError<T extends readonly any[], Err extends string> = {
  [K in keyof T]: Err;
};

/**
 * Serializable dependency graph node.
 * `name` is "anonymous" when the module was defined without a name.
 */
export interface ModuleGraphNode {
  name: string;
  deps: ModuleGraphNode[];
}
