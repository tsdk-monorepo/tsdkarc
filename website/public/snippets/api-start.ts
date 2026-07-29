import { defineModule, type ModuleMeta } from 'tsdkarc';

// .start() is a method chained off your root initialized module
const rootModule = defineModule({ modules: [/* ... */] }).init();

rootModule.start(options?: {
  // Global boot hooks
  beforeBoot?(ctx: Record<never, never>): any | Promise<any>;
  afterBoot?(ctx: Context): any | Promise<any>;
  
  // Global shutdown hooks (includes optional reason)
  beforeShutdown?(ctx: Context, reason?: string): any | Promise<any>;
  afterShutdown?(ctx: Context, reason?: string): any | Promise<any>;
  
  // Per-module boot hooks
  beforeEachBoot?(ctx: object, meta: ModuleMeta): any | Promise<any>;
  afterEachBoot?(ctx: object, meta: ModuleMeta): any | Promise<any>;
  
  // Per-module shutdown hooks
  beforeEachShutdown?(ctx: object, meta: ModuleMeta, reason?: string): any | Promise<any>;
  afterEachShutdown?(ctx: object, meta: ModuleMeta, reason?: string): any | Promise<any>;

  // ❌ onError is REMOVED. 
  // If boot fails, .start() automatically rolls back and throws the error directly.

}): Promise<{ 
  ctx: Context; 
  stop(reason?: string): Promise<void>;
}>;