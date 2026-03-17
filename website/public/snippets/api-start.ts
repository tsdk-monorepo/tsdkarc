import start, { type Module,  } from 'tsdkarc';

start(modules: Module[], hooks?: {
  beforeBoot?(ctx): void | Promise<void>,
  afterBoot?(ctx): void | Promise<void>,
  beforeShutdown?(ctx): void | Promise<void>,
  afterShutdown?(ctx): void | Promise<void>,
  beforeEachBoot?(ctx): void | Promise<void>,
  afterEachBoot?(ctx): void | Promise<void>,
  beforeEachShutdown?(ctx): void | Promise<void>,
  afterEachShutdown?(ctx): void | Promise<void>,
}): Promise<{ ctx, stop() }>