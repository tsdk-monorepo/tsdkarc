import { defineModule, Module, type ContextOf, type SetOf,type ContextWriterOf } from 'tsdkarc';

defineModule()
defineModule<OwnSlice>()({
  name: string;
  description?: string;
  modules: Module[];
  boot?(ctx): OwnSlice | Promise<OwnSlice> | void | Promise<void>,
  beforeBoot?(ctx): void | Promise<void>;
  afterBoot?(ctx): void | Promise<void>;
  shutdown?(ctx): void | Promise<void>;
  beforeShutdown?(ctx): void | Promise<void>;
  afterShutdown?(ctx): void | Promise<void>;
})


type ModuleContext = ContextOf<Module>