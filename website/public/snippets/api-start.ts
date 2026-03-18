import start, { type Module,  } from 'tsdkarc';

start(modules: Module[], hooks?: {
  beforeBoot?(ctx): void | Promise<void>,
  afterBoot?(ctx): void | Promise<void>,
  beforeShutdown?(ctx): void | Promise<void>,
  afterShutdown?(ctx): void | Promise<void>,
  beforeEachBoot?(ctx, module): void | Promise<void>,
  afterEachBoot?(ctx, module): void | Promise<void>,
  beforeEachShutdown?(ctx, module): void | Promise<void>,
  afterEachShutdown?(ctx, module): void | Promise<void>,
  onError?(error, ctx, module): void | Promise<void>,
}): Promise<{ ctx, stop() }>