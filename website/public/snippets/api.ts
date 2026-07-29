import { defineModule, type AnyModule } from 'tsdkarc';

// Step 1: Configuration (Identity & Dependencies)
defineModule(meta?: {
  name?: string;               // Optional: Namespaces the returned state under ctx[name]
  modules?: AnyModule[];       // Optional: Array of modules this module depends on
  ignoreConflicts?: string[];  // Optional: Keys allowed to deep-merge if anonymous module fields collide
})

// Step 2: Implementation (Logic & Lifecycle)
.init(
  // The boot function: receives dependency ctx, returns this module's state/API
  bootFn?: (ctx: DepContext) => OwnSlice | Promise<OwnSlice> | void | Promise<void>,
  
  // Module-level lifecycle hooks (scoped ONLY to this module)
  hooks?: {
    beforeBoot?(ctx: DepContext): any | Promise<any>;
    afterBoot?(ctx: DepContext): any | Promise<any>;
    beforeShutdown?(ctx: DepContext): any | Promise<any>;
    shutdown?(ctx: DepContext): any | Promise<any>;
    afterShutdown?(ctx: DepContext): any | Promise<any>;
  }
) 

// -> Returns an InitializedModule with the following methods:
/* => {
    // Starts the composition (boots all dependencies in topological order)
    start(options?: StartOptions): Promise<{ 
      ctx: FinalCtx; 
      stop(reason?: string): Promise<void>;
    }>;

    // Injects additional dependencies on the fly (returns a new module instance)
    with(...modules: AnyModule[]): InitializedModule;

    // Generates a visual and structural dependency tree
    graph(): { 
      formatted: string; // The printable tree string
      // ... internal nodes/edges array ...
    };
} */